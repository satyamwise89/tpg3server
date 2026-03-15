import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import cors from "cors";

const app = express();

app.use(express.json());
app.use(cors());

/* ---------- MEMORY ---------- */

let raceStore = {};
let scrapedResults = {};
let winnerReport = {};
let browserLog = {};
let compareLog = {};
let lastScrapeTime = "";

/* ---------- HORSE NORMALIZER ---------- */

function normalizeHorse(name){
if(!name) return "";

return name
.toLowerCase()
.replace(/\(.*?\)/g,"")
.replace(/[^a-z0-9 ]/g,"")
.replace(/\s+/g," ")
.trim();
}

/* ---------- SCRAPER ---------- */

async function scrapeResults(){

try{

const url="https://www.indiarace.com/Home/racingCenterEvent?venueId=1&event_date=2026-03-12&race_type=RESULTS";

const res = await axios.get(url);

const $ = cheerio.load(res.data);

let results={};

$("div[id^='race-']").each((i,r)=>{

const raceTime=$(r)
.find(".archive_time h4")
.eq(1)
.text()
.trim()
.toUpperCase();

let winner="";
let withdrawn=[];

$(r).find("tbody tr").each((i,row)=>{

const pl=$(row).find("td").eq(0).text().trim();

const horse=$(row)
.find("td")
.eq(2)
.find("h5 a")
.text()
.trim();

const jockey=$(row).find("td").eq(5).text().trim();

if(pl==="1"){
winner=horse;
}

if(pl==="W" || jockey.toLowerCase().includes("withdrawn")){
withdrawn.push(horse);
}

});

if(raceTime){

results[raceTime]={
winner,
withdrawn
};

}

});

scrapedResults=results;

lastScrapeTime=new Date().toLocaleTimeString();

console.log("SCRAPED RESULTS:",results);

}catch(e){

console.log("SCRAPE ERROR:",e);

}

}

/* ---------- AUTO SCRAPE ---------- */

setInterval(async()=>{

await scrapeResults();
buildComparison();

},10000);

/* ---------- BUILD COMPARISON ---------- */

function buildComparison(){

Object.keys(raceStore).forEach(time=>{

const tp=raceStore[time]?.tp;
const g3=raceStore[time]?.g3;

let merged={};

/* ---------- TP ---------- */

if(tp){

tp.horses.forEach(h=>{

const n=normalizeHorse(h.name);

merged[n]={
horse:h.name,
tp:h.pnl,
g3:0
};

});

}

/* ---------- G3 ---------- */

if(g3){

g3.horses.forEach(h=>{

const n=normalizeHorse(h.name);

if(!merged[n]){

merged[n]={
horse:h.name,
tp:0,
g3:h.pnl
};

}else{

merged[n].g3=h.pnl;

}

});

}

/* ---------- WINNER ---------- */

let winnerHorse=scrapedResults[time]?.winner;

let winnerData=null;

if(winnerHorse){

const wn=normalizeHorse(winnerHorse);

if(merged[wn]){

winnerData={
horse:winnerHorse,
tpPnl:merged[wn].tp,
g3Pnl:merged[wn].g3
};

}

}

winnerReport[time]=winnerData;
compareLog[time]=merged;

});

}

/* ---------- RECEIVE BROWSER DATA ---------- */

app.post("/race-data",(req,res)=>{

const {panel,raceTime,soda,horses}=req.body;

if(!raceStore[raceTime]){
raceStore[raceTime]={};
}

if(!raceStore[raceTime][panel]){
raceStore[raceTime][panel]={
soda:0,
horses:[]
};
}

/* update soda */

raceStore[raceTime][panel].soda=soda;

/* merge horses */

horses.forEach(newHorse=>{

const n=normalizeHorse(newHorse.name);

const existing=raceStore[raceTime][panel].horses.find(h=>
normalizeHorse(h.name)===n
);

if(existing){

/* overwrite latest pnl */

existing.pnl=newHorse.pnl;

}else{

/* new horse add */

raceStore[raceTime][panel].horses.push(newHorse);

}

});

browserLog[raceTime]=req.body;

console.log("DATA RECEIVED:",raceTime,panel);

buildComparison();

res.json({status:"ok"});

});

/* ---------- TEST MODE ---------- */

app.post("/test",(req,res)=>{

const {horse,raceTime,pnl,soda,panel}=req.body;

if(!raceStore[raceTime]){
raceStore[raceTime]={};
}

const side = panel === "g3" ? "g3" : "tp";

raceStore[raceTime][side]={

soda:Number(soda)||0,

horses:[
{
name:horse,
pnl:Number(pnl)||0
}
]

};

buildComparison();

const result=scrapedResults[raceTime];

let winner=false;

if(result){

const h=normalizeHorse(horse);
const w=normalizeHorse(result.winner);

if(h===w){
winner=true;
}

}

res.json({

horse,
raceTime,
pnl,
soda,
panel:side,
winner,
scrapedWinner:result?.winner||null

});

});

/* ---------- DASHBOARD ---------- */

app.get("/dashboard",(req,res)=>{

let html=`

<h1>TP + G3 Winner Dashboard</h1>

<p>Last Scrape: ${lastScrapeTime}</p>

<meta http-equiv="refresh" content="5">

<table border="1" style="border-collapse:collapse;font-size:14px">

<tr style="background:#ddd">

<th>Race Time</th>
<th>Horse Name</th>
<th>TP Soda</th>
<th>G3 Soda</th>
<th>TP PNL</th>
<th>G3 PNL</th>
<th>Withdrawn</th>

</tr>

`;

Object.keys(winnerReport).forEach(time=>{

const winner=winnerReport[time];

if(!winner) return;

const tpSoda=raceStore[time]?.tp?.soda || 0;
const g3Soda=raceStore[time]?.g3?.soda || 0;

const withdrawnList=scrapedResults[time]?.withdrawn || [];

const isWithdrawn = withdrawnList.some(w =>
normalizeHorse(w) === normalizeHorse(winner.horse)
);

const rowStyle=isWithdrawn
?"style='background:pink'"
:"style='background:lightgreen;font-weight:bold'";

html+=`

<tr ${rowStyle}>

<td>${time}</td>
<td>${winner.horse}</td>
<td>${tpSoda}</td>
<td>${g3Soda}</td>
<td>${winner.tpPnl}</td>
<td>${winner.g3Pnl}</td>
<td>${isWithdrawn ? "YES" : ""}</td>

</tr>

`;

});

html+=`</table>`;

/* ---------- DEBUG ---------- */

html+=`

<hr>

<h2>Debug Section</h2>

<h3>Browser Data</h3>
<pre>${JSON.stringify(browserLog,null,2)}</pre>

<h3>Scraped Data</h3>
<pre>${JSON.stringify(scrapedResults,null,2)}</pre>

<h3>Comparison Data</h3>
<pre>${JSON.stringify(compareLog,null,2)}</pre>

`;

res.send(html);

});

/* ---------- HOME ---------- */

app.get("/",(req,res)=>{

res.send(`
<h2>TP + G3 Server Running</h2>
<a href="/dashboard">Open Dashboard</a>
`);

});

/* ---------- SERVER ---------- */

const PORT=process.env.PORT || 3000;

app.listen(PORT,()=>{

console.log("================================");
console.log("TP + G3 SERVER RUNNING");
console.log("PORT:",PORT);
console.log("================================");

});

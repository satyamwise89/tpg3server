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

/* ---------- SCRAPER ---------- */

async function scrapeResults(){

try{

const url="https://www.indiarace.com/Home/racingCenterEvent?venueId=1&event_date=2026-03-12&race_type=RESULTS";

const res = await axios.get(url);

const $ = cheerio.load(res.data);

let results={};

$("div[id^='race-']").each((i,r)=>{

// header example: "Race 1 - 4:00 PM"

const header=$(r).find("h3").text().trim();

let raceTime="";

const match=header.match(/\d{1,2}:\d{2}\s?(AM|PM)/i);

if(match){
raceTime=match[0].toUpperCase();
}

let winner="";
let withdrawn=[];

$(r).find("tbody tr").each((i,row)=>{

const pl=$(row).find("td").eq(0).text().trim();

const horse=$(row).find("td").eq(2).text().trim().split("\n")[0].trim();

const jockey=$(row).find("td").eq(5).text().trim();

if(pl==="1"){
winner=horse;
}

if(jockey.toLowerCase().includes("withdrawn")){
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

/* ---------- AUTO SCRAPE EVERY 10s ---------- */

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

if(tp){

tp.horses.forEach(h=>{

merged[h.name]={

tp:h.pnl,
g3:0

};

});

}

if(g3){

g3.horses.forEach(h=>{

if(!merged[h.name]){

merged[h.name]={

tp:0,
g3:h.pnl

};

}else{

merged[h.name].g3=h.pnl;

}

});

}

let winnerHorse=scrapedResults[time]?.winner;

let winnerData=null;

if(winnerHorse && merged[winnerHorse]){

winnerData={

horse:winnerHorse,
tpPnl:merged[winnerHorse].tp,
g3Pnl:merged[winnerHorse].g3

};

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

raceStore[raceTime][panel]={

soda,
horses

};

browserLog[raceTime]=req.body;

console.log("DATA RECEIVED:",raceTime,panel);

buildComparison();

res.json({status:"ok"});

});

/* ---------- TEST MODE ---------- */

app.post("/test",(req,res)=>{

const {horse}=req.body;

let winner=false;

Object.values(scrapedResults).forEach(r=>{

if(r.winner===horse){
winner=true;
}

});

res.json({

horse,
winner

});

});

/* ---------- DASHBOARD ---------- */

app.get("/dashboard",(req,res)=>{

let html=`

<h1>TP + G3 Winner Dashboard</h1>

<p>Last Scrape: ${lastScrapeTime}</p>

`;

/* ---------- WINNER TABLE ---------- */

Object.keys(winnerReport).forEach(time=>{

const w=winnerReport[time];

if(!w) return;

html+=`

<h2>Race ${time}</h2>

<table border="1" style="border-collapse:collapse">

<tr>

<th>Horse</th>
<th>TP PNL</th>
<th>G3 PNL</th>

</tr>

<tr style="background:lightgreen">

<td>${w.horse}</td>
<td>${w.tpPnl}</td>
<td>${w.g3Pnl}</td>

</tr>

</table>

`;

});

/* ---------- DEBUG SECTION ---------- */

html+=`

<hr>

<h2>Browser Data</h2>

<pre>${JSON.stringify(browserLog,null,2)}</pre>

<h2>Scraped Data</h2>

<pre>${JSON.stringify(scrapedResults,null,2)}</pre>

<h2>Comparison Data</h2>

<pre>${JSON.stringify(compareLog,null,2)}</pre>

`;

res.send(html);

});

/* ---------- HOME ---------- */

app.get("/",(req,res)=>{

res.send(`

<h2>TP + G3 Server Running</h2>

<p>Open Dashboard:</p>

<a href="/dashboard">Dashboard</a>

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

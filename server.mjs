import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import cors from "cors";

const app = express();

app.use(express.json());
app.use(cors());

/* ---------- MEMORY ---------- */

let raceStore = {};
let lastScrapedData = {};
let mergedReport = [];

/* ---------- SCRAPER ---------- */

async function scrapeResults(){

try{

const url="https://www.indiarace.com/Home/racingCenterEvent?venueId=1&event_date=2026-03-12&race_type=RESULTS";

const res = await axios.get(url);

const $ = cheerio.load(res.data);

let races = {};

$("div[id^='race-']").each((i,r)=>{

const raceNo = $(r).attr("id").replace("race-","");

let winner="";
let withdrawn=[];

$(r).find("tbody tr").each((i,row)=>{

const pl=$(row).find("td").eq(0).text().trim();

const horse=$(row).find("td").eq(2).text().trim().split("\n")[0].trim();

const jockey=$(row).find("td").eq(5).text().trim();

if(pl==="1") winner=horse;

if(jockey.toLowerCase().includes("withdrawn")){
withdrawn.push(horse);
}

});

races[raceNo]={winner,withdrawn};

});

lastScrapedData = races;

}catch(e){

console.log("SCRAPE ERROR",e);

}

}

/* ---------- AUTO SCRAPER ---------- */

setInterval(async()=>{

await scrapeResults();

updateReport();

console.log("SCRAPER UPDATED");

},10000);

/* ---------- MERGE TP + G3 ---------- */

function updateReport(){

Object.keys(raceStore).forEach(raceTime=>{

const tp = raceStore[raceTime]?.tp;
const g3 = raceStore[raceTime]?.g3;

if(!tp && !g3) return;

let merged = {};

if(tp){

tp.horses.forEach(h=>{

merged[h.name] = {
tpPnl:h.pnl,
g3Pnl:0
};

});

}

if(g3){

g3.horses.forEach(h=>{

if(!merged[h.name]){
merged[h.name]={tpPnl:0,g3Pnl:h.pnl};
}else{
merged[h.name].g3Pnl=h.pnl;
}

});

}

let report=[];

Object.keys(merged).forEach(name=>{

let winner=false;
let withdrawn=false;

Object.values(lastScrapedData).forEach(r=>{

if(r.winner===name) winner=true;

if(r.withdrawn.includes(name)) withdrawn=true;

});

report.push({

horse:name,
tpPnl:merged[name].tpPnl,
g3Pnl:merged[name].g3Pnl,
winner,
withdrawn

});

});

mergedReport = report;

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

console.log("DATA RECEIVED:",panel);

updateReport();

res.json({status:"ok"});

});

/* ---------- DASHBOARD ---------- */

app.get("/dashboard",(req,res)=>{

res.send(`
<html>
<head>
<title>Race Server</title>

<style>

body{
font-family:Arial;
padding:20px;
background:#f5f5f5;
}

table{
border-collapse:collapse;
background:white;
}

td,th{
border:1px solid #ccc;
padding:6px 10px;
}

.winner{
background:#8ef58e;
}

.withdrawn{
background:#ffb6c1;
}

</style>

</head>

<body>

<h2>Scraped Results</h2>
<pre>${JSON.stringify(lastScrapedData,null,2)}</pre>

<h2>Merged TP + G3 Report</h2>

<table>

<tr>
<th>Horse</th>
<th>TP PNL</th>
<th>G3 PNL</th>
<th>Status</th>
</tr>

${mergedReport.map(r=>{

let cls="";

let status="";

if(r.winner){
cls="winner";
status="WINNER";
}

if(r.withdrawn){
cls="withdrawn";
status="WITHDRAWN";
}

return `
<tr class="${cls}">
<td>${r.horse}</td>
<td>${r.tpPnl}</td>
<td>${r.g3Pnl}</td>
<td>${status}</td>
</tr>
`;

}).join("")}

</table>

</body>
</html>
`);

});

/* ---------- SERVER ---------- */

app.listen(3000,()=>{

console.log("================================");
console.log("TP + G3 MERGE SERVER RUNNING");
console.log("https://tpg3server.onrender.com/dashboard");
console.log("================================");

});

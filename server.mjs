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
let finalReport = {};

/* ---------- SCRAPER ---------- */

async function scrapeResults(){

try{

const url="https://www.indiarace.com/Home/racingCenterEvent?venueId=1&event_date=2026-03-12&race_type=RESULTS";

const res = await axios.get(url);

const $ = cheerio.load(res.data);

let results={};

$("div[id^='race-']").each((i,r)=>{

const raceTime=$(r).find(".raceTime").text().trim();

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

if(raceTime){
results[raceTime]={
winner,
withdrawn
};
}

});

scrapedResults=results;

}catch(e){

console.log("SCRAPE ERROR",e);

}

}

/* ---------- AUTO SCRAPE ---------- */

setInterval(async()=>{

await scrapeResults();

buildReports();

},10000);

/* ---------- BUILD REPORT ---------- */

function buildReports(){

Object.keys(raceStore).forEach(raceTime=>{

const tp=raceStore[raceTime]?.tp;
const g3=raceStore[raceTime]?.g3;

if(!tp && !g3) return;

let merged={};

if(tp){

tp.horses.forEach(h=>{

merged[h.name]={
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

const r=scrapedResults[raceTime];

if(r){

if(r.winner===name) winner=true;

if(r.withdrawn.includes(name)) withdrawn=true;

}

report.push({
horse:name,
tpPnl:merged[name].tpPnl,
g3Pnl:merged[name].g3Pnl,
winner,
withdrawn
});

});

finalReport[raceTime]=report;

});

}

/* ---------- RECEIVE DATA ---------- */

app.post("/race-data",(req,res)=>{

const {panel,raceTime,soda,horses}=req.body;

if(!raceStore[raceTime]){
raceStore[raceTime]={};
}

raceStore[raceTime][panel]={
soda,
horses
};

console.log("DATA RECEIVED:",raceTime,panel);

buildReports();

res.json({status:"ok"});

});

/* ---------- DASHBOARD ---------- */

app.get("/dashboard",(req,res)=>{

let html=`<h2>Race Comparison Dashboard</h2>`;

Object.keys(finalReport).forEach(time=>{

html+=`<h3>Race ${time}</h3>`;

html+=`
<table border="1" style="border-collapse:collapse">
<tr>
<th>Horse</th>
<th>TP PNL</th>
<th>G3 PNL</th>
<th>Status</th>
</tr>
`;

finalReport[time].forEach(r=>{

let status="";

let color="";

if(r.winner){
status="WINNER";
color="lightgreen";
}

if(r.withdrawn){
status="WITHDRAWN";
color="pink";
}

html+=`
<tr style="background:${color}">
<td>${r.horse}</td>
<td>${r.tpPnl}</td>
<td>${r.g3Pnl}</td>
<td>${status}</td>
</tr>
`;

});

html+=`</table><br>`;

});

res.send(html);

});

/* ---------- SERVER ---------- */

app.listen(3000,()=>{

console.log("TP + G3 TIME MATCH SERVER RUNNING");

});

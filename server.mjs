import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import cors from "cors";
import pkg from "pg";

const { Pool } = pkg;

const app = express();
app.use(express.json());
app.use(cors());

/* ---------- DATABASE ---------- */

const pool = new Pool({
connectionString: process.env.DATABASE_URL,
ssl: { rejectUnauthorized: false }
});

/* ---------- MEMORY ---------- */

let raceStore = {};
let scrapedResults = {};
let winnerReport = {};
let compareLog = {};
let browserLog = {};
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

/* ---------- DB INIT ---------- */

async function initDatabase(){

await pool.query(`
CREATE TABLE IF NOT EXISTS races (
id SERIAL PRIMARY KEY,
date TEXT,
race_time TEXT,
panel TEXT,
soda INTEGER,
UNIQUE(date,race_time,panel)
);
`);

await pool.query(`
CREATE TABLE IF NOT EXISTS horses (
id SERIAL PRIMARY KEY,
race_time TEXT,
horse TEXT,
tp_pnl INTEGER DEFAULT 0,
g3_pnl INTEGER DEFAULT 0,
UNIQUE(race_time,horse)
);
`);

console.log("DATABASE READY");

}

/* ---------- SCRAPER ---------- */

async function scrapeResults(){

try{

const url="https://www.indiarace.com/Home/racingCenterEvent?venueId=1&event_date=2026-03-12&race_type=RESULTS";

const res=await axios.get(url);

const $=cheerio.load(res.data);

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

if(pl==="1"){
winner=horse;
}

if(pl==="W"){
withdrawn.push(horse);
}

});

if(raceTime){
results[raceTime]={winner,withdrawn};
}

});

scrapedResults=results;

lastScrapeTime=new Date().toLocaleTimeString();

buildComparison();

}catch(e){

console.log("SCRAPER ERROR",e);

}

}

/* ---------- AUTO SCRAPE ---------- */

setInterval(scrapeResults,10000);

/* ---------- BUILD COMPARISON ---------- */

function buildComparison(){

Object.keys(raceStore).forEach(time=>{

const tp=raceStore[time]?.tp;
const g3=raceStore[time]?.g3;

let merged={};

/* TP */

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

/* G3 */

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

/* WINNER */

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

app.post("/race-data", async(req,res)=>{

const {panel,raceTime,soda,horses}=req.body;

const today=new Date().toISOString().split("T")[0];

if(!raceStore[raceTime]) raceStore[raceTime]={};

if(!raceStore[raceTime][panel]){

raceStore[raceTime][panel]={

soda:0,
horses:[]

};

}

/* update soda */

raceStore[raceTime][panel].soda=soda;

/* merge horses */

horses.forEach(h=>{

const n=normalizeHorse(h.name);

const existing=raceStore[raceTime][panel].horses.find(x=>
normalizeHorse(x.name)===n
);

if(existing){

existing.pnl=h.pnl;

}else{

raceStore[raceTime][panel].horses.push(h);

}

});

/* SAVE RACE */

await pool.query(

`INSERT INTO races(date,race_time,panel,soda)
VALUES($1,$2,$3,$4)
ON CONFLICT (date,race_time,panel)
DO UPDATE SET soda=$4`,

[today,raceTime,panel,soda]

);

/* SAVE HORSES */

for(const h of horses){

await pool.query(

`INSERT INTO horses(race_time,horse,tp_pnl,g3_pnl)
VALUES($1,$2,$3,$4)
ON CONFLICT (race_time,horse)
DO UPDATE SET
tp_pnl = CASE WHEN $3>0 THEN $3 ELSE horses.tp_pnl END,
g3_pnl = CASE WHEN $4>0 THEN $4 ELSE horses.g3_pnl END`,

[
raceTime,
h.name,
panel==="tp"?h.pnl:0,
panel==="g3"?h.pnl:0
]

);

}

browserLog[raceTime]=req.body;

buildComparison();

res.json({status:"ok"});

});

/* ---------- DASHBOARD ---------- */

app.get("/dashboard",(req,res)=>{

let html=`

<h1>TP + G3 Winner Dashboard</h1>

<p>Last Scrape: ${lastScrapeTime}</p>

<meta http-equiv="refresh" content="5">

<table border="1">

<tr>

<th>Race Time</th>
<th>Horse</th>
<th>TP Soda</th>
<th>G3 Soda</th>
<th>TP PNL</th>
<th>G3 PNL</th>

</tr>

`;

Object.keys(winnerReport).forEach(time=>{

const w=winnerReport[time];

if(!w) return;

const tpSoda=raceStore[time]?.tp?.soda||0;
const g3Soda=raceStore[time]?.g3?.soda||0;

html+=`

<tr style="background:lightgreen">

<td>${time}</td>
<td>${w.horse}</td>
<td>${tpSoda}</td>
<td>${g3Soda}</td>
<td>${w.tpPnl}</td>
<td>${w.g3Pnl}</td>

</tr>

`;

});

html+="</table>";

/* DEBUG */

html+=`

<hr>

<h3>Debug</h3>

<h4>Browser Data</h4>
<pre>${JSON.stringify(browserLog,null,2)}</pre>

<h4>Scraped</h4>
<pre>${JSON.stringify(scrapedResults,null,2)}</pre>

<h4>Compare</h4>
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

/* ---------- SERVER START ---------- */

const PORT=process.env.PORT||3000;

async function startServer(){

await initDatabase();

app.listen(PORT,()=>{

console.log("================================");
console.log("TP + G3 SERVER RUNNING");
console.log("PORT:",PORT);
console.log("================================");

});

}

startServer();

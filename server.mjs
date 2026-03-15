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
let lastScrapeTime = "";

/* ---------- NORMALIZER ---------- */

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

console.log("SCRAPE ERROR:",e);

}

}

/* ---------- AUTO SCRAPE ---------- */

setInterval(scrapeResults,10000);

/* ---------- COMPARISON ---------- */

function buildComparison(){

Object.keys(raceStore).forEach(time=>{

const tp=raceStore[time]?.tp;
const g3=raceStore[time]?.g3;

let merged={};

if(tp){

tp.horses.forEach(h=>{

const n=normalizeHorse(h.name);

merged[n]={horse:h.name,tp:h.pnl,g3:0};

});

}

if(g3){

g3.horses.forEach(h=>{

const n=normalizeHorse(h.name);

if(!merged[n]){

merged[n]={horse:h.name,tp:0,g3:h.pnl};

}else{

merged[n].g3=h.pnl;

}

});

}

let winnerHorse=scrapedResults[time]?.winner;

if(winnerHorse){

const wn=normalizeHorse(winnerHorse);

if(merged[wn]){

winnerReport[time]={

horse:winnerHorse,
tpPnl:merged[wn].tp,
g3Pnl:merged[wn].g3

};

}

}

compareLog[time]=merged;

});

}

/* ---------- RECEIVE BROWSER DATA ---------- */

app.post("/race-data",async(req,res)=>{

const {panel,raceTime,soda,horses}=req.body;

const today=new Date().toISOString().split("T")[0];

if(!raceStore[raceTime]) raceStore[raceTime]={};

if(!raceStore[raceTime][panel]){

raceStore[raceTime][panel]={soda:0,horses:[]};

}

raceStore[raceTime][panel].soda=soda;

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
DO UPDATE SET tp_pnl=$3,g3_pnl=$4`,

[
raceTime,
h.name,
panel==="tp"?h.pnl:0,
panel==="g3"?h.pnl:0
]

);

}

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
<th>TP PNL</th>
<th>G3 PNL</th>

</tr>

`;

Object.keys(winnerReport).forEach(time=>{

const w=winnerReport[time];

html+=`

<tr style="background:lightgreen">

<td>${time}</td>
<td>${w.horse}</td>
<td>${w.tpPnl}</td>
<td>${w.g3Pnl}</td>

</tr>

`;

});

html+="</table>";

res.send(html);

});

/* ---------- SERVER ---------- */

const PORT=process.env.PORT||3000;

app.listen(PORT,()=>{

console.log("SERVER RUNNING",PORT);

});

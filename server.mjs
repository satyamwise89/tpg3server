import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import cors from "cors";

const app = express();

app.use(express.json());
app.use(cors());

let lastBrowserData = {};
let lastScrapedData = {};
let lastReport = [];

/* ---------- SCRAPER ---------- */

async function scrapeResults(){

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

return races;

}

/* ---------- API ---------- */

app.post("/race-data", async(req,res)=>{

const {panel,raceTime,soda,horses}=req.body;

lastBrowserData = {
panel,
raceTime,
soda,
horses
};

const results = await scrapeResults();

let report=[];

horses.forEach(h=>{

let isWinner=false;
let isWithdrawn=false;

Object.values(results).forEach(r=>{

if(r.winner===h.name) isWinner=true;

if(r.withdrawn.includes(h.name)) isWithdrawn=true;

});

report.push({
horse:h.name,
pnl:h.pnl,
winner:isWinner,
withdrawn:isWithdrawn
});

});

lastReport = report;

console.log("DATA RECEIVED FROM BROWSER");
console.log(lastBrowserData);

console.log("SCRAPED RESULTS");
console.log(lastScrapedData);

console.log("FINAL REPORT");
console.log(lastReport);

res.json({status:"ok"});

});

/* ---------- DASHBOARD ---------- */

app.get("/dashboard",(req,res)=>{

res.send(`
<html>
<head>
<title>Race Debug Dashboard</title>
<style>

body{
font-family:Arial;
padding:20px;
background:#f5f5f5;
}

pre{
background:white;
padding:15px;
border-radius:6px;
overflow:auto;
}

h2{
margin-top:40px;
}

</style>
</head>

<body>

<h1>Race Debug Dashboard</h1>

<h2>Browser Data</h2>
<pre>${JSON.stringify(lastBrowserData,null,2)}</pre>

<h2>Scraped IndiaRace Results</h2>
<pre>${JSON.stringify(lastScrapedData,null,2)}</pre>

<h2>Comparison Report</h2>
<pre>${JSON.stringify(lastReport,null,2)}</pre>

</body>
</html>
`);

});

/* ---------- SERVER ---------- */

app.listen(3000,()=>{

console.log("================================");
console.log("RACE DEBUG SERVER RUNNING");
console.log("http://localhost:3000/dashboard");
console.log("================================");

});
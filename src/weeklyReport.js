import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { calculateLuckRows } from './luckIndex'

const C = { ink:'#111827', paper:'#f7f3ea', gold:'#d97706', green:'#047857', playoffBg:'#dcfce7', red:'#b91c1c', blue:'#1d4ed8', muted:'#6b7280', line:'#d6d3d1' }
const esc = (value = '') => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')
const score = value => Number(value || 0).toFixed(2)
const pct = value => `${Number(value || 0).toFixed(1)}%`
const teamName = team => team?.team_name || team?.canonical_name || 'Unknown Team'
const managerName = team => team?.canonical_name || team?.display_name || teamName(team)
const section = label => `<div style="border-top:2px solid ${C.ink};border-bottom:1px solid ${C.ink};padding:7px 0 6px;margin-bottom:9px;font-family:Arial,sans-serif;font-size:8px;font-weight:900;letter-spacing:1.2px;color:${C.gold};text-transform:uppercase;">${esc(label)}</div>`

const liveGames = (liveData, week, season) => (liveData?.matchups_by_week?.[String(week)] || [])
  .filter(pair => Array.isArray(pair) && pair.length >= 2)
  .map(pair => {
    const away = pair[0].team_info || pair[0]
    const home = pair[1].team_info || pair[1]
    const awayScore = Number(pair[0].points || 0)
    const homeScore = Number(pair[1].points || 0)
    const awayWon = awayScore >= homeScore
    return { awayScore, homeScore, winner:managerName(awayWon ? away : home), loser:managerName(awayWon ? home : away), season, week }
  })

const playoffRound = (season, week) => {
  const rounds = Number(season) <= 2020
    ? { 14:'Quarters', 15:'Semis', 16:'Finals' }
    : { 15:'Quarters', 16:'Semis', 17:'Finals' }
  return rounds[Number(week)] || 'Playoffs'
}

const matchupHistory = (log, a, b) => {
  const games = log.filter(game => {
    const away = String(game.awayTeamName||'').toLowerCase()
    const home = String(game.homeTeamName||'').toLowerCase()
    const ma = String(a||'').toLowerCase()
    const mb = String(b||'').toLowerCase()
    return (away===ma && home===mb) || (away===mb && home===ma)
  }).sort((x,y) => Number(y.season)-Number(x.season) || Number(y.week)-Number(x.week))
  const lastFive=games.slice(0,5)
  const wins=name => lastFive.filter(game => String(game.winner||'').toLowerCase()===String(name||'').toLowerCase()).length
  const aWins=wins(a), bWins=wins(b)
  const lastFiveText=aWins>bWins?`${a} ${aWins}-${bWins}`:bWins>aWins?`${b} ${bWins}-${aWins}`:`Tied ${aWins}-${bWins}`
  const playoff=games.find(game => String(game.game_type||'').toLowerCase()==='playoff' || game.is_championship)
  if(playoff) return { lastFiveText, note:`${playoff.season} ${playoffRound(playoff.season,playoff.week)} rematch` }
  const closest=[...games].sort((x,y)=>Number(x.margin||99)-Number(y.margin||99))[0]
  if(closest && Number(closest.margin||99)<=3) return { lastFiveText, note:`Closest game: ${closest.winner||'Tie'} won by ${score(closest.margin)} - ${closest.season} W${closest.week}` }
  const blowout=[...games].sort((x,y)=>Number(y.margin||0)-Number(x.margin||0))[0]
  if(blowout && Number(blowout.margin||0)>=35) return { lastFiveText, note:`Biggest blowout: ${blowout.winner||'Winner'} won by ${score(blowout.margin)} - ${blowout.season} W${blowout.week}` }
  return { lastFiveText, note:'' }
}

const ordinal = value => {
  const n=Number(value), mod100=n%100
  if(mod100>=11&&mod100<=13)return `${n}th`
  return `${n}${n%10===1?'st':n%10===2?'nd':n%10===3?'rd':'th'}`
}

const historicalRankings = (log, throughWeek, currentSeason) => {
  const regular=log.filter(game=>String(game.game_type||'regular').toLowerCase()==='regular')
  const playoffGames=log.filter(game=>String(game.game_type||'').toLowerCase()==='playoff')
  const full=new Map(), starts=new Map()
  const key=(season,team)=>`${season}|${team}`
  regular.forEach(game=>{
    const season=Number(game.season)
    ;['away','home'].forEach(side=>{
      const team=game[`${side}TeamName`], id=key(season,team), points=Number(game[`${side}Score`]||0)
      const total=full.get(id)||{season,team,wins:0,losses:0,ties:0,pf:0,games:0}
      total.games+=1;total.pf+=points
      if(game.winner===team)total.wins+=1;else if(game.loser===team)total.losses+=1;else total.ties+=1
      full.set(id,total)
      if(Number(game.week)<=throughWeek){const start=starts.get(id)||{season,team,pf:0,games:0,wins:0,losses:0,ties:0};start.pf+=points;start.games+=1;if(game.winner===team)start.wins+=1;else if(game.loser===team)start.losses+=1;else start.ties+=1;starts.set(id,start)}
    })
  })
  const ranks=new Map()
  ;[...new Set([...full.values()].map(item=>item.season))].forEach(season=>{
    [...full.values()].filter(item=>item.season===season).sort((a,b)=>b.wins-a.wins||b.pf-a.pf).forEach((item,index)=>ranks.set(key(season,item.team),index+1))
  })
  const outcome=item=>{
    const total=full.get(key(item.season,item.team));const record=`${total.wins}-${total.losses}${total.ties?`-${total.ties}`:''}`
    if(item.season===currentSeason)return `Current ${record}`
    const games=playoffGames.filter(game=>Number(game.season)===item.season&&[game.awayTeamName,game.homeTeamName].includes(item.team))
    if(!games.length)return `${ordinal(ranks.get(key(item.season,item.team)))}, ${record}; missed playoffs`
    const final=games.find(game=>game.is_championship)
    if(final)return `${ordinal(ranks.get(key(item.season,item.team)))}, ${record}; ${final.winner===item.team?'Champion':'Finalist'}`
    const deepest=[...games].sort((a,b)=>Number(b.week)-Number(a.week))[0]
    return `${ordinal(ranks.get(key(item.season,item.team)))}, ${record}; ${playoffRound(item.season,deepest.week)}`
  }
  const entries=[...starts.values()].filter(item=>item.games===throughWeek).map(item=>({...item,outcome:outcome(item)}))
  const top=[...entries].sort((a,b)=>b.pf-a.pf).slice(0,5)
  const bottom=[...entries].sort((a,b)=>a.pf-b.pf).slice(0,5)
  const current=entries.filter(item=>item.season===currentSeason)
  const completed=entries.filter(item=>item.season<currentSeason)
  const facts=[]
  const recordGroups=new Map()
  current.forEach(item=>{const id=`${item.wins}-${item.losses}`;if(!recordGroups.has(id))recordGroups.set(id,[]);recordGroups.get(id).push(item)})
  recordGroups.forEach((members,id)=>{
    const [wins,losses]=id.split('-').map(Number)
    const cohort=completed.filter(item=>item.wins===wins&&item.losses===losses)
    if(cohort.length<5)return
    const made=cohort.filter(item=>playoffGames.some(game=>Number(game.season)===item.season&&[game.awayTeamName,game.homeTeamName].includes(item.team))).length
    const champs=cohort.filter(item=>playoffGames.some(game=>Number(game.season)===item.season&&game.is_championship&&game.winner===item.team)).length
    const names=members.map(item=>item.team).join(members.length===2?' and ':', ')
    facts.push({score:70+Math.abs((made/cohort.length)*100-50)/5,text:`${names} ${members.length===1?'is':'are'} ${id}. Historically, ${made} of ${cohort.length} (${((made/cohort.length)*100).toFixed(1)}%) comparable starts made the playoffs${champs?`; ${champs} won the title`:''}.`})
  })
  const byPf=[...entries].sort((a,b)=>b.pf-a.pf)
  current.forEach(item=>{
    const rank=byPf.findIndex(row=>row.season===item.season&&row.team===item.team)+1
    if(rank<=Math.ceil(byPf.length*.1))facts.push({score:80-rank,text:`${item.team}'s ${item.pf.toFixed(2)} PF ranks ${ordinal(rank)} of ${byPf.length} starts through Week ${throughWeek}.`})
    else if(rank>byPf.length-Math.ceil(byPf.length*.1))facts.push({score:80-(byPf.length-rank+1),text:`${item.team}'s ${item.pf.toFixed(2)} PF ranks ${ordinal(rank)} of ${byPf.length} starts through Week ${throughWeek}.`})
  })
  return { top, bottom, facts, topHasCurrent:top.some(item=>item.season===currentSeason), bottomHasCurrent:bottom.some(item=>item.season===currentSeason) }
}

const selectHistoricalContext = (base, odds) => {
  const facts=[...base.facts]
  const mover=[...odds].sort((a,b)=>Math.abs(Number(b.delta||0))-Math.abs(Number(a.delta||0)))[0]
  if(mover&&Math.abs(Number(mover.delta||0))>=5)facts.push({score:65+Math.min(20,Math.abs(Number(mover.delta||0))),text:`${mover.name}'s playoff probability moved ${mover.delta>0?'+':''}${Number(mover.delta).toFixed(1)} points, the league's largest weekly swing.`})
  facts.sort((a,b)=>b.score-a.score)
  if(base.topHasCurrent&&base.bottomHasCurrent)return {kind:'rankings',panels:[['Top five starts',base.top],['Bottom five starts',base.bottom]],facts}
  if(base.topHasCurrent)return {kind:'mixed',panels:[['Top five starts',base.top]],facts:facts.slice(0,2)}
  if(base.bottomHasCurrent)return {kind:'mixed',panels:[['Bottom five starts',base.bottom]],facts:facts.slice(0,2)}
  return {kind:facts.length===1?'feature':'bullets',panels:[],facts:facts.slice(0,3)}
}

const historicalMarkup = context => {
  const panel=([label,rows])=>`<div><div style="font-family:Arial,sans-serif;font-size:6px;font-weight:900;color:${C.muted};text-transform:uppercase;margin-bottom:3px;">${label} by PF</div>${rows.map((item,index)=>`<div style="height:13px;display:grid;grid-template-columns:12px 1fr 43px 1.4fr;gap:4px;align-items:center;border-bottom:1px solid ${C.line};font-family:Arial,sans-serif;font-size:5.5px;"><strong style="color:${C.gold};">${index+1}</strong><strong>${esc(item.team)} '${String(item.season).slice(-2)}</strong><span style="text-align:right;font-weight:800;">${score(item.pf)}</span><span style="text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(item.outcome)}</span></div>`).join('')}</div>`
  const facts=`<div style="display:grid;gap:7px;align-content:start;">${context.facts.map((fact,index)=>`<div style="display:grid;grid-template-columns:12px 1fr;gap:6px;font-family:Arial,sans-serif;font-size:${context.kind==='feature'?'8px':'6.5px'};line-height:1.35;"><strong style="color:${C.gold};">${context.kind==='feature'?'◆':'•'}</strong><span>${esc(fact.text)}</span></div>`).join('')}</div>`
  if(context.kind==='rankings')return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:-2px;margin-bottom:5px;">${context.panels.map(panel).join('')}</div>`
  if(context.kind==='mixed')return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:-2px;margin-bottom:5px;">${panel(context.panels[0])}${facts}</div>`
  return `<div style="margin-top:-2px;margin-bottom:5px;padding:3px 2px;">${facts}</div>`
}

export async function downloadWeeklyNewsletter({ liveData, excelData, simResults, currentMatchups, selectedWeek, getH2HRecord }) {
  const currentWeek=Number(liveData?.current_week||1)
  const recapWeek=Math.max(1,currentWeek-1)
  const previewWeek=Number(selectedWeek||currentWeek)
  const season=Number(liveData?.season||2026)
  const log=excelData?.MatchLog_PlayoffIncluded||[]
  const archived=log.filter(game=>Number(game.season)===season&&Number(game.week)===recapWeek)
  const games=(archived.length?archived:liveGames(liveData,recapWeek,season)).slice(0,6)
  const standings=[...(liveData?.standings||[])].sort((a,b)=>Number(a.rank||99)-Number(b.rank||99))
  const teams=new Map(standings.map(team=>[String(team.canonical_name||'').toLowerCase(),team]))
  const display=manager=>teamName(teams.get(String(manager||'').toLowerCase()))
  const playoff=new Set((liveData?.playoff_picture||[]).map(item=>item.team?.canonical_name))
  const danger=new Set((liveData?.punishment_watch||[]).map(item=>item.canonical_name))
  const headlineGame=[...games].sort((a,b)=>Math.max(Number(b.awayScore||0),Number(b.homeScore||0))-Math.max(Number(a.awayScore||0),Number(a.homeScore||0)))[0]
  const headlineManager=headlineGame?(Number(headlineGame.awayScore||0)>=Number(headlineGame.homeScore||0)?headlineGame.awayTeamName:headlineGame.homeTeamName):''
  const headlineTeam=display(headlineManager)
  const luck=calculateLuckRows(standings,{
    matchupsByWeek:liveData?.matchups_by_week,
    matchLog:log,
    season,
    throughWeek:recapWeek,
  })
  const historicalBase=historicalRankings(log,recapWeek,season)

  const snapshots=liveData?.playoff_odds_history?.snapshots||{}
  const currentSnapshot=snapshots[String(recapWeek)]?.results||simResults||[]
  const previousSnapshot=snapshots[String(recapWeek-1)]?.results||[]
  const previousByName=new Map(previousSnapshot.map(item=>[String(item.name||'').toLowerCase(),item]))
  const odds=[...currentSnapshot].sort((a,b)=>Number(b.playoffPct||0)-Number(a.playoffPct||0)).map(item=>({
    ...item,
    delta:Number(item.playoffPct||0)-Number(previousByName.get(String(item.name||'').toLowerCase())?.playoffPct||0),
  }))
  const historical=selectHistoricalContext(historicalBase,odds)

  const report=document.createElement('section')
  report.setAttribute('style',`box-sizing:border-box;width:794px;height:1123px;padding:39px 48px 28px;overflow:hidden;position:relative;background:${C.paper};color:${C.ink};font-family:Georgia,"Times New Roman",serif;`)
  report.innerHTML=`
    <div style="display:grid;grid-template-columns:48px 1fr 95px;align-items:center;gap:12px;">
      <img src="/league_logo.jpg" alt="Blaj league logo" style="width:44px;height:44px;object-fit:cover;"/>
      <div style="font-size:42px;line-height:1;font-weight:900;text-align:center;">BLAJ WEEKLY</div>
      <div style="font-family:Arial,sans-serif;text-align:right;font-size:8px;line-height:1.7;color:${C.muted};text-transform:uppercase;">Week ${recapWeek} | ${season}<br/>Next: Week ${previewWeek}</div>
    </div>
    <div style="border-top:4px solid ${C.ink};border-bottom:1px solid ${C.ink};margin-top:10px;padding:7px 0 6px;font-family:Arial,sans-serif;font-size:7px;font-weight:800;color:${C.muted};text-transform:uppercase;">The official league intelligence newspaper</div>
    <div style="font-size:30px;line-height:1.05;font-weight:900;margin-top:15px;">${esc(headlineTeam)} owns Week ${recapWeek}</div>
    <div style="font-size:10px;line-height:1.4;color:${C.muted};margin-top:7px;">Week ${recapWeek} is in the books. The standings are taking shape, the playoff model is moving, and six Week ${previewWeek} matchups are next.</div>

    <div style="margin-top:12px;">${section(`Week ${recapWeek} final scores`)}</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0 19px;">
      ${games.map(game=>{const winnerScore=Math.max(Number(game.awayScore||0),Number(game.homeScore||0));const loserScore=Math.min(Number(game.awayScore||0),Number(game.homeScore||0));return `<div style="height:47px;border-bottom:1px solid ${C.line};padding:4px 0;box-sizing:border-box;font-family:Arial,sans-serif;"><div style="display:flex;justify-content:space-between;gap:6px;font-size:7px;font-weight:900;"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(display(game.winner))}</span><span>${score(winnerScore)}</span></div><div style="display:flex;justify-content:space-between;gap:6px;font-size:7px;color:${C.muted};margin-top:5px;"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(display(game.loser))}</span><span>${score(loserScore)}</span></div></div>`}).join('')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:15px;height:324px;">
      <div style="padding-right:12px;border-right:1px solid ${C.line};">
        ${section('Standings & luck index')}
        <div style="display:grid;grid-template-columns:20px minmax(0,1fr) 28px 38px 43px 38px;gap:3px;padding-bottom:5px;border-bottom:1px solid ${C.ink};font-family:Arial,sans-serif;font-size:6px;font-weight:900;color:${C.muted};text-transform:uppercase;"><span>#</span><span>Team</span><span>Rec</span><span style="text-align:right;">PF</span><span>Exp</span><span style="text-align:right;">Luck</span></div>
        ${luck.map(team=>{const isPlayoff=playoff.has(team.canonical_name);const isDanger=danger.has(team.canonical_name);const sign=team.luck>0?'+':'';return `<div style="height:20px;display:grid;grid-template-columns:20px minmax(0,1fr) 28px 38px 43px 38px;gap:3px;align-items:center;border-bottom:1px solid ${C.line};background:${isPlayoff?C.playoffBg:'transparent'};font-family:Arial,sans-serif;"><strong style="font-size:8px;color:${isDanger?C.red:isPlayoff?C.green:C.ink};">${esc(team.rank)}</strong><strong style="font-size:6.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(teamName(team))}</strong><span style="font-size:6px;">${Number(team.wins||0)}-${Number(team.losses||0)}</span><span style="font-size:6px;text-align:right;">${score(team.points_for)}</span><span style="font-size:6px;">${team.expectedWins.toFixed(1)}-${team.expectedLosses.toFixed(1)}</span><strong style="font-size:7px;text-align:right;color:${team.luck>.1?C.green:team.luck<-.1?C.red:C.muted};">${sign}${team.luck.toFixed(1)}</strong></div>`}).join('')}
      </div>
      <div>
        ${section(`Playoff outlook | 10k sims | vs Week ${Math.max(1,recapWeek-1)}`)}
        <div style="display:grid;grid-template-columns:1fr 53px 38px 40px 40px;gap:4px;padding-bottom:5px;border-bottom:1px solid ${C.ink};font-family:Arial,sans-serif;font-size:6px;font-weight:900;color:${C.muted};text-transform:uppercase;"><span>Team</span><span style="text-align:right;">Playoff</span><span style="text-align:right;">Change</span><span style="text-align:right;">Bye</span><span style="text-align:right;">Last</span></div>
        ${odds.map(item=>{const team=teams.get(String(item.name||'').toLowerCase());const tiny=Number(item.playoffCount||0)<100?` (${Number(item.playoffCount||0).toLocaleString()})`:'';const sign=item.delta>0?'+':'';return `<div style="height:20px;display:grid;grid-template-columns:1fr 53px 38px 40px 40px;gap:4px;align-items:center;border-bottom:1px solid ${C.line};font-family:Arial,sans-serif;"><strong style="font-size:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(teamName(team))}</strong><span style="font-size:6px;text-align:right;font-weight:900;">${pct(item.playoffPct)}${tiny}</span><span style="font-size:6px;text-align:right;color:${item.delta>0?C.green:item.delta<0?C.red:C.muted};">${sign}${item.delta.toFixed(1)}</span><span style="font-size:6px;text-align:right;">${pct(item.byePct)}</span><span style="font-size:6px;text-align:right;">${pct(item.lastPct)}</span></div>`}).join('')}
      </div>
    </div>

    <div style="margin-top:5px;">${section(`Historical context | through Week ${recapWeek}`)}</div>
    ${historicalMarkup(historical)}

    <div style="margin-top:4px;">${section(`Week ${previewWeek} preview`)}</div>
    <div style="font-size:23px;font-weight:900;margin-top:7px;margin-bottom:6px;">Six games to watch</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 28px;">
      ${(currentMatchups||[]).slice(0,6).map((pair,index)=>{if(!pair||pair.length<2)return'';const rawA=pair[0].team_info||pair[0];const rawB=pair[1].team_info||pair[1];const a=teams.get(String(managerName(rawA)).toLowerCase())||rawA;const b=teams.get(String(managerName(rawB)).toLowerCase())||rawB;const history=matchupHistory(log,managerName(a),managerName(b));const allTime=getH2HRecord(managerName(a),managerName(b));return `<div style="height:65px;padding:4px 0;border-bottom:1px solid ${C.line};box-sizing:border-box;"><div style="font-family:Arial,sans-serif;font-size:5.5px;font-weight:900;color:${C.gold};text-transform:uppercase;">Matchup ${index+1}</div><div style="display:grid;grid-template-columns:1fr 22px 1fr;gap:5px;align-items:end;margin-top:2px;"><div><strong style="display:block;font-size:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(teamName(a))}</strong><span style="font-family:Arial,sans-serif;font-size:5.5px;color:${C.muted};">${Number(a.wins||0)}-${Number(a.losses||0)}</span></div><span style="font-size:6px;text-align:center;color:${C.gold};">vs</span><div style="text-align:right;"><strong style="display:block;font-size:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(teamName(b))}</strong><span style="font-family:Arial,sans-serif;font-size:5.5px;color:${C.muted};">${Number(b.wins||0)}-${Number(b.losses||0)}</span></div></div><div style="display:flex;justify-content:space-between;gap:8px;margin-top:3px;font-family:Arial,sans-serif;font-size:5.5px;font-weight:800;"><span>All-time: ${esc(allTime)}</span><span>L5: ${esc(history.lastFiveText)}</span></div>${history.note?`<div style="margin-top:2px;font-family:Arial,sans-serif;font-size:5.5px;color:${C.blue};">${esc(history.note)}</div>`:''}</div>`}).join('')}
    </div>
    <div style="position:absolute;left:48px;right:48px;bottom:15px;border-top:1px solid ${C.ink};padding-top:6px;display:flex;justify-content:space-between;font-family:Arial,sans-serif;font-size:7px;color:${C.muted};text-transform:uppercase;"><span>Blaj Weekly | Week ${recapWeek}</span><span>One-page portrait edition</span></div>
  `

  const shell=document.createElement('div');shell.style.position='absolute';shell.style.left='-10000px';shell.style.top='0';shell.appendChild(report);document.body.appendChild(shell)
  try{
    const canvas=await html2canvas(report,{scale:2,backgroundColor:C.paper,useCORS:true,logging:false})
    const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true})
    pdf.addImage(canvas.toDataURL('image/jpeg',0.95),'JPEG',0,0,210,297,undefined,'FAST')
    pdf.save(`Blaj_Weekly_Week_${recapWeek}.pdf`)
  }finally{document.body.removeChild(shell)}
}

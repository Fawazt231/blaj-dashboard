import React, { useState, useEffect, useMemo } from 'react'
import Trophy from 'lucide-react/dist/esm/icons/trophy'
import Flame from 'lucide-react/dist/esm/icons/flame'
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert'
import BookOpen from 'lucide-react/dist/esm/icons/book-open'
import Calendar from 'lucide-react/dist/esm/icons/calendar'
import Award from 'lucide-react/dist/esm/icons/award'
import Search from 'lucide-react/dist/esm/icons/search'
import ArrowUpDown from 'lucide-react/dist/esm/icons/arrow-up-down'
import ArrowUp from 'lucide-react/dist/esm/icons/arrow-up'
import ArrowDown from 'lucide-react/dist/esm/icons/arrow-down'
import Camera from 'lucide-react/dist/esm/icons/camera'
import X from 'lucide-react/dist/esm/icons/x'
import Filter from 'lucide-react/dist/esm/icons/list-filter'
import Cpu from 'lucide-react/dist/esm/icons/cpu'
import Play from 'lucide-react/dist/esm/icons/play'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import Sliders from 'lucide-react/dist/esm/icons/sliders-horizontal'
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up'
import TrendingDown from 'lucide-react/dist/esm/icons/trending-down'
import Zap from 'lucide-react/dist/esm/icons/zap'
import Copy from 'lucide-react/dist/esm/icons/copy'
import Check from 'lucide-react/dist/esm/icons/check'
import Share2 from 'lucide-react/dist/esm/icons/share-2'
import FileDown from 'lucide-react/dist/esm/icons/file-down'
import { runPlayoffSimulation } from './playoffSimulatorEngine'
import { downloadWeeklyNewsletter } from './weeklyReport'
import { resolveCurrentWeek } from './seasonWeek'
import { SIMULATION_MODEL } from './simulationModelConfig'
import { calculateLuckRows } from './luckIndex'
import { buildProjectionLookup, buildProjectionTeamLookup, projectedLineupTotal } from './sleeperProjections'
import SimulationExplorer from './SimulationExplorer'
import { collectCompletedWeeklyScores } from './simulationInputs'

const MONTH_NAMES_MAP = {
  1: { short: 'Jan', full: 'January' },
  2: { short: 'Feb', full: 'February' },
  3: { short: 'Mar', full: 'March' },
  4: { short: 'Apr', full: 'April' },
  5: { short: 'May', full: 'May' },
  6: { short: 'Jun', full: 'June' },
  7: { short: 'Jul', full: 'July' },
  8: { short: 'Aug', full: 'August' },
  9: { short: 'Sep', full: 'September' },
  10: { short: 'Oct', full: 'October' },
  11: { short: 'Nov', full: 'November' },
  12: { short: 'Dec', full: 'December' }
}

// User-friendly names for Excel sheets
const SHEET_LABEL_MAP = {
  'PerManagerSummary': 'Manager Summaries',
  'PlayoffSummary': 'Playoff Summary',
  'Top10_Seasons': 'Top 10 Seasons (Avg PF)',
  'H2H_AllTime': 'H2H All-Time',
  'H2H_Last5': 'H2H Last 5',
  'DraftHistory': 'Draft History',
  'MatchLog': 'Match Log'
}

const generateFunFacts = (excelData) => {
  if (!excelData) return []
  const facts = []

  const perManager = excelData.PerManagerSummary || []
  const playoff = excelData.PlayoffSummary || []
  const h2hAll = excelData.H2H_AllTime || []
  const matchLog = excelData.MatchLog_PlayoffIncluded || []
  const top10Seasons = excelData.Top10_Seasons_InclPlayoffs || excelData.Top10_Seasons_Reg || []

  // 1. Playoff Clutch King
  if (playoff.length > 0) {
    const sortedPlayoffWin = [...playoff]
      .filter(p => (p.playoff_games || 0) >= 3)
      .sort((a, b) => (b.playoff_win_pct || 0) - (a.playoff_win_pct || 0))
    if (sortedPlayoffWin.length > 0) {
      const top = sortedPlayoffWin[0]
      facts.push({
        id: 'playoff_clutch_king',
        category: 'Playoffs',
        badge: '#d97706',
        title: '👑 Playoff Clutch King',
        description: `${top.manager} holds the highest playoff win rate in league history at ${((top.playoff_win_pct || 0) * 100).toFixed(1)}% (${top.playoff_wins || 0}W - ${top.playoff_losses || 0}L across ${top.playoff_appearances || 0} postseason berths)!`,
        stats: `${((top.playoff_win_pct || 0) * 100).toFixed(1)}% Win Rate (${top.playoff_wins}-${top.playoff_losses})`,
        managers: [top.manager]
      })
    }
  }

  // 2. Multi-Championship Dynasty
  const multiChamps = playoff.filter(p => (p.championship_wins || 0) >= 2)
  if (multiChamps.length > 0) {
    const names = multiChamps.map(p => p.manager).join(' and ')
    facts.push({
      id: 'multi_champs',
      category: 'Playoffs',
      badge: '#d97706',
      title: '🏆 Multi-Title Dynasty',
      description: `${names} stand atop the league mantle as the only managers with multiple Championship trophies in league history (2 titles each)!`,
      stats: '2 Trophies Each',
      managers: multiChamps.map(p => p.manager)
    })
  }

  // 3. Regular Season Dominator
  if (perManager.length > 0) {
    const sortedReg = [...perManager].sort((a, b) => (b.regular_season_win_pct || 0) - (a.regular_season_win_pct || 0))
    const topReg = sortedReg[0]
    facts.push({
      id: 'reg_season_king',
      category: 'Records',
      badge: '#d97706',
      title: '📈 Regular Season Machine',
      description: `${topReg.manager} leads all managers in all-time regular season win percentage at ${((topReg.regular_season_win_pct || 0) * 100).toFixed(1)}% (${topReg.all_time_record})!`,
      stats: `${((topReg.regular_season_win_pct || 0) * 100).toFixed(1)}% Reg Win Rate`,
      managers: [topReg.manager]
    })
  }

  // 4. All-Time Single Game Scoring High
  if (perManager.length > 0) {
    const sortedHigh = [...perManager].sort((a, b) => (b.highest_score || 0) - (a.highest_score || 0))
    const topHigh = sortedHigh[0]
    facts.push({
      id: 'single_game_high',
      category: 'Records',
      badge: '#d97706',
      title: '💥 All-Time Single Game Scoring High',
      description: `${topHigh.manager} erupted for an all-time single-game league record of ${topHigh.highest_score} points!`,
      stats: `${topHigh.highest_score} PTS (League Record)`,
      managers: [topHigh.manager]
    })
  }

  // 5. Week 1 Specialist
  if (perManager.length > 0) {
    const week1Specialists = [...perManager]
      .map(m => {
        const parts = (m.week1_record || '0-0-0').split('-').map(Number)
        const w = parts[0] || 0
        const l = parts[1] || 0
        const pct = (w + l) > 0 ? w / (w + l) : 0
        return { manager: m.manager, record: m.week1_record, pct, w, total: w + l }
      })
      .filter(m => m.total >= 4)
      .sort((a, b) => b.pct - a.pct)

    if (week1Specialists.length > 0) {
      const topW1 = week1Specialists[0]
      facts.push({
        id: 'week1_specialist',
        category: 'Records',
        badge: '#d97706',
        title: '⚡ Week 1 Opener Specialist',
        description: `${topW1.manager} dominates Opening Week matchups with a ${topW1.record} record (${(topW1.pct * 100).toFixed(1)}% win rate) across ${topW1.total} Opening Days!`,
        stats: `${topW1.record} in Week 1 (${(topW1.pct * 100).toFixed(1)}%)`,
        managers: [topW1.manager]
      })
    }
  }

  // 6. Highest Scoring Matchup Loss (Heartbreaker)
  if (matchLog.length > 0) {
    let biggestHeartbreak = null
    matchLog.forEach(row => {
      const hScore = Number(row.homeScore) || 0
      const aScore = Number(row.awayScore) || 0
      if (hScore > 0 && aScore > 0) {
        if (hScore > aScore) {
          if (!biggestHeartbreak || aScore > biggestHeartbreak.loserScore) {
            biggestHeartbreak = {
              winner: row.homeTeamName,
              winnerScore: hScore,
              loser: row.awayTeamName,
              loserScore: aScore,
              season: row.season,
              week: row.week
            }
          }
        } else if (aScore > hScore) {
          if (!biggestHeartbreak || hScore > biggestHeartbreak.loserScore) {
            biggestHeartbreak = {
              winner: row.awayTeamName,
              winnerScore: aScore,
              loser: row.homeTeamName,
              loserScore: hScore,
              season: row.season,
              week: row.week
            }
          }
        }
      }
    })

    if (biggestHeartbreak) {
      facts.push({
        id: 'biggest_heartbreak',
        category: 'Records',
        badge: '#f43f5e',
        title: '💔 Ultimate Heartbreaker Loss',
        description: `In ${biggestHeartbreak.season} Week ${biggestHeartbreak.week}, ${biggestHeartbreak.loser} scored a massive ${biggestHeartbreak.loserScore.toFixed(2)} points but still lost to ${biggestHeartbreak.winner} (${biggestHeartbreak.winnerScore.toFixed(2)} pts) in the highest-scoring loss in league history!`,
        stats: `${biggestHeartbreak.loserScore.toFixed(2)} PTS in a Loss`,
        managers: [biggestHeartbreak.loser, biggestHeartbreak.winner]
      })
    }
  }

  // 7. H2H Rivalry Dominance
  if (h2hAll.length > 0) {
    let topDomination = null
    h2hAll.forEach(row => {
      const m1 = row.manager
      const m2 = row.opponent
      const w = Number(row.W) || 0
      const l = Number(row.L) || 0
      const total = w + l
      if (m1 && m2 && m1 !== m2 && total >= 5) {
        const diff = w - l
        if (!topDomination || diff > topDomination.diff) {
          topDomination = { m1, m2, w, l, total, diff, pct: w / total }
        }
      }
    })

    if (topDomination) {
      facts.push({
        id: 'h2h_domination',
        category: 'Rivalries',
        badge: '#d97706',
        title: '🔥 Head-to-Head Rivalry Dominance',
        description: `${topDomination.m1} holds a dominant ${topDomination.w}-${topDomination.l} record over ${topDomination.m2} in ${topDomination.total} all-time matchups (${(topDomination.pct * 100).toFixed(1)}% win rate)!`,
        stats: `${topDomination.w}-${topDomination.l} (${(topDomination.pct * 100).toFixed(1)}%)`,
        managers: [topDomination.m1, topDomination.m2]
      })
    }
  }

  // 8. Playoff Marathon Leader
  if (playoff.length > 0) {
    const sortedGames = [...playoff].sort((a, b) => (b.playoff_games || 0) - (a.playoff_games || 0))
    const topMarathon = sortedGames[0]
    facts.push({
      id: 'playoff_marathon',
      category: 'Playoffs',
      badge: '#818cf8',
      title: '🏃‍♂️ Playoff Marathon Veteran',
      description: `${topMarathon.manager} has battled in ${topMarathon.playoff_games} total playoff games across ${topMarathon.playoff_appearances} postseason appearances!`,
      stats: `${topMarathon.playoff_games} Postseason Games`,
      managers: [topMarathon.manager]
    })
  }

  // 9. Playoff Qualification Royalty
  if (perManager.length > 0) {
    const sortedBerths = [...perManager].sort((a, b) => (b.playoff_appearances || 0) - (a.playoff_appearances || 0))
    const topBerthCount = sortedBerths[0].playoff_appearances || 0
    const topBerthManagers = sortedBerths.filter(m => (m.playoff_appearances || 0) === topBerthCount).map(m => m.manager)
    if (topBerthManagers.length > 0) {
      facts.push({
        id: 'playoff_berth_kings',
        category: 'Playoffs',
        badge: '#d97706',
        title: '🎟️ Playoff Qualification Royalty',
        description: `${topBerthManagers.join(' and ')} hold the all-time record for most playoff qualifications in league history with ${topBerthCount} postseason berths!`,
        stats: `${topBerthCount} Playoff Berths Each`,
        managers: topBerthManagers
      })
    }
  }

  // 10. Lowest Single Game Score Record
  if (perManager.length > 0) {
    const sortedLow = [...perManager].sort((a, b) => (a.lowest_score || 999) - (b.lowest_score || 999))
    const topLow = sortedLow[0]
    facts.push({
      id: 'lowest_game_score',
      category: 'Records',
      badge: '#64748b',
      title: '🥶 Lowest Single-Game Scoring Record',
      description: `${topLow.manager} holds the record for the lowest single-game score in league history at ${topLow.lowest_score} points in a rough week!`,
      stats: `${topLow.lowest_score} PTS (All-Time Low)`,
      managers: [topLow.manager]
    })
  }

  // 11. 50/50 Deadlocked Rivalries
  if (h2hAll.length > 0) {
    const deadlocks = []
    h2hAll.forEach(row => {
      const m1 = row.manager
      const m2 = row.opponent
      const w = Number(row.W) || 0
      const l = Number(row.L) || 0
      if (m1 && m2 && m1 < m2 && w === l && w >= 3) {
        deadlocks.push({ m1, m2, w, l, total: w + l })
      }
    })
    if (deadlocks.length > 0) {
      const d = deadlocks[0]
      facts.push({
        id: 'deadlock_rivalry',
        category: 'Rivalries',
        badge: '#f43f5e',
        title: '⚖️ Perfectly Deadlocked Rivalry',
        description: `${d.m1} and ${d.m2} are locked in a dead heat with an exact ${d.w}-${d.l} head-to-head record across ${d.total} all-time games!`,
        stats: `Tied ${d.w}-${d.l} All-Time`,
        managers: [d.m1, d.m2]
      })
    }
  }

  // 12. Largest Blowout Victory Margin
  if (matchLog.length > 0) {
    let biggestBlowout = null
    matchLog.forEach(row => {
      const hScore = Number(row.homeScore) || 0
      const aScore = Number(row.awayScore) || 0
      if (hScore > 0 && aScore > 0) {
        const diff = Math.abs(hScore - aScore)
        if (!biggestBlowout || diff > biggestBlowout.diff) {
          const winner = hScore > aScore ? row.homeTeamName : row.awayTeamName
          const loser = hScore > aScore ? row.awayTeamName : row.homeTeamName
          const winScore = Math.max(hScore, aScore)
          const loseScore = Math.min(hScore, aScore)
          biggestBlowout = { winner, loser, winScore, loseScore, diff, season: row.season, week: row.week }
        }
      }
    })

    if (biggestBlowout) {
      facts.push({
        id: 'biggest_blowout',
        category: 'Records',
        badge: '#d97706',
        title: '💥 Largest Blowout Victory Margin',
        description: `In ${biggestBlowout.season} Week ${biggestBlowout.week}, ${biggestBlowout.winner} crushed ${biggestBlowout.loser} by ${biggestBlowout.diff.toFixed(2)} points (${biggestBlowout.winScore.toFixed(2)} to ${biggestBlowout.loseScore.toFixed(2)}) - the largest margin of victory ever recorded!`,
        stats: `+${biggestBlowout.diff.toFixed(2)} Margin Victory`,
        managers: [biggestBlowout.winner, biggestBlowout.loser]
      })
    }
  }

  // 13. Title Game Conversion Rate (100% Win Rate in Finals)
  if (playoff.length > 0) {
    const perfectTitleWins = playoff.filter(p => (p.championship_appearances || 0) > 0 && p.championship_appearances === p.championship_wins)
    if (perfectTitleWins.length > 0) {
      const p = perfectTitleWins[0]
      facts.push({
        id: 'title_conversion',
        category: 'Playoffs',
        badge: '#d97706',
        title: '🎯 Perfect Title Game Conversion',
        description: `${p.manager} holds a 100% conversion rate in League Finals, winning all ${p.championship_wins} Championship games reached!`,
        stats: `${p.championship_wins} for ${p.championship_appearances} in Finals`,
        managers: [p.manager]
      })
    }
  }

  // 14. Most Finals Appearances (Championship Regulars)
  if (playoff.length > 0) {
    const sortedFinals = [...playoff].sort((a, b) => (b.championship_appearances || 0) - (a.championship_appearances || 0))
    const topFinalist = sortedFinals[0]
    facts.push({
      id: 'finals_regular',
      category: 'Playoffs',
      badge: '#818cf8',
      title: '🏆 Championship Game Regular',
      description: `${topFinalist.manager} has battled in the League Championship Finals ${topFinalist.championship_appearances} separate times!`,
      stats: `${topFinalist.championship_appearances} Finals Appearances`,
      managers: [topFinalist.manager]
    })
  }

  // 15. Frequent Foes (Most Matchups Between Two Managers)
  if (h2hAll.length > 0) {
    let topFrequent = null
    h2hAll.forEach(row => {
      const m1 = row.manager
      const m2 = row.opponent
      const w = Number(row.W) || 0
      const l = Number(row.L) || 0
      const total = w + l
      if (m1 && m2 && m1 < m2) {
        if (!topFrequent || total > topFrequent.total) {
          topFrequent = { m1, m2, total, w, l }
        }
      }
    })
    if (topFrequent) {
      facts.push({
        id: 'frequent_foes',
        category: 'Rivalries',
        badge: '#d97706',
        title: '⚔️ Frequent Foes',
        description: `${topFrequent.m1} and ${topFrequent.m2} are the most frequent opponents in league history, clashing ${topFrequent.total} all-time times!`,
        stats: `${topFrequent.total} Matchups Played`,
        managers: [topFrequent.m1, topFrequent.m2]
      })
    }
  }

  // 16. Highest Scoring Matchup Ever Recorded (Combined Points)
  if (matchLog.length > 0) {
    let topCombinedMatchup = null
    matchLog.forEach(row => {
      const hScore = Number(row.homeScore) || 0
      const aScore = Number(row.awayScore) || 0
      const combined = hScore + aScore
      if (hScore > 0 && aScore > 0) {
        if (!topCombinedMatchup || combined > topCombinedMatchup.combined) {
          topCombinedMatchup = {
            t1: row.homeTeamName,
            s1: hScore,
            t2: row.awayTeamName,
            s2: aScore,
            combined,
            season: row.season,
            week: row.week
          }
        }
      }
    })
    if (topCombinedMatchup) {
      facts.push({
        id: 'high_score_matchup',
        category: 'Records',
        badge: '#d97706',
        title: '💥 Highest Scoring Combined Matchup',
        description: `In ${topCombinedMatchup.season} Week ${topCombinedMatchup.week}, ${topCombinedMatchup.t1} (${topCombinedMatchup.s1.toFixed(2)}) and ${topCombinedMatchup.t2} (${topCombinedMatchup.s2.toFixed(2)}) combined for a record-shattering ${topCombinedMatchup.combined.toFixed(2)} total points!`,
        stats: `${topCombinedMatchup.combined.toFixed(2)} Combined PTS`,
        managers: [topCombinedMatchup.t1, topCombinedMatchup.t2]
      })
    }
  }

  // 17. Narrowest Victory Margin in League History
  if (matchLog.length > 0) {
    let narrowestWin = null
    matchLog.forEach(row => {
      const hScore = Number(row.homeScore) || 0
      const aScore = Number(row.awayScore) || 0
      if (hScore > 0 && aScore > 0 && hScore !== aScore) {
        const diff = Math.abs(hScore - aScore)
        if (!narrowestWin || diff < narrowestWin.diff) {
          const winner = hScore > aScore ? row.homeTeamName : row.awayTeamName
          const loser = hScore > aScore ? row.awayTeamName : row.homeTeamName
          const winScore = Math.max(hScore, aScore)
          const loseScore = Math.min(hScore, aScore)
          narrowestWin = { winner, loser, winScore, loseScore, diff, season: row.season, week: row.week }
        }
      }
    })
    if (narrowestWin) {
      facts.push({
        id: 'narrowest_victory',
        category: 'Records',
        badge: '#f43f5e',
        title: '⚡ Narrowest Victory Margin in History',
        description: `In ${narrowestWin.season} Week ${narrowestWin.week}, ${narrowestWin.winner} squeaked past ${narrowestWin.loser} by a razor-thin ${narrowestWin.diff.toFixed(2)} points (${narrowestWin.winScore.toFixed(2)} to ${narrowestWin.loseScore.toFixed(2)})!`,
        stats: `+${narrowestWin.diff.toFixed(2)} PTS Difference`,
        managers: [narrowestWin.winner, narrowestWin.loser]
      })
    }
  }

  // 18. Undefeated Wall Against Opponent (min 3 games)
  if (h2hAll.length > 0) {
    let brickWall = null
    h2hAll.forEach(row => {
      const m1 = row.manager
      const m2 = row.opponent
      const w = Number(row.W) || 0
      const l = Number(row.L) || 0
      if (m1 && m2 && m1 !== m2 && l === 0 && w >= 3) {
        if (!brickWall || w > brickWall.w) {
          brickWall = { m1, m2, w }
        }
      }
    })
    if (brickWall) {
      facts.push({
        id: 'brick_wall',
        category: 'Rivalries',
        badge: '#d97706',
        title: '🧱 The Brick Wall',
        description: `${brickWall.m1} remains undefeated against ${brickWall.m2} with a perfect ${brickWall.w}-0 head-to-head record!`,
        stats: `Undefeated ${brickWall.w}-0 Record`,
        managers: [brickWall.m1, brickWall.m2]
      })
    }
  }

  // 19. Highest Single Season Scoring Average
  if (top10Seasons.length > 0) {
    const topSeason = top10Seasons[0]
    facts.push({
      id: 'top_season_avg',
      category: 'Records',
      badge: '#d97706',
      title: '📈 All-Time Highest Season Average Scoring',
      description: `In ${topSeason.season || 'league history'}, ${topSeason.manager} recorded the single highest weekly scoring average in league history at ${Number(topSeason.avg_points_per_game || topSeason.avg_pf || 0).toFixed(2)} points per game!`,
      stats: `${Number(topSeason.avg_points_per_game || topSeason.avg_pf || 0).toFixed(2)} PPG Average`,
      managers: [topSeason.manager]
    })
  }

  // 20. Lowest Combined Matchup Record
  if (matchLog.length > 0) {
    let lowestCombinedMatchup = null
    matchLog.forEach(row => {
      const hScore = Number(row.homeScore) || 0
      const aScore = Number(row.awayScore) || 0
      const combined = hScore + aScore
      if (hScore > 0 && aScore > 0) {
        if (!lowestCombinedMatchup || combined < lowestCombinedMatchup.combined) {
          lowestCombinedMatchup = {
            t1: row.homeTeamName,
            s1: hScore,
            t2: row.awayTeamName,
            s2: aScore,
            combined,
            season: row.season,
            week: row.week
          }
        }
      }
    })
    if (lowestCombinedMatchup) {
      facts.push({
        id: 'lowest_score_matchup',
        category: 'Records',
        badge: '#64748b',
        title: '🥶 Lowest Combined Scoring Matchup',
        description: `In ${lowestCombinedMatchup.season} Week ${lowestCombinedMatchup.week}, ${lowestCombinedMatchup.t1} (${lowestCombinedMatchup.s1.toFixed(2)}) and ${lowestCombinedMatchup.t2} (${lowestCombinedMatchup.s2.toFixed(2)}) combined for a defensive battle of just ${lowestCombinedMatchup.combined.toFixed(2)} total points!`,
        stats: `${lowestCombinedMatchup.combined.toFixed(2)} Combined PTS`,
        managers: [lowestCombinedMatchup.t1, lowestCombinedMatchup.t2]
      })
    }
  }

  // 21. Defensive Target (Unluckiest Manager with Highest Points-Against)
  if (matchLog.length > 0) {
    const pointsAgainstMap = {}
    const gamesCountMap = {}
    matchLog.forEach(row => {
      const hScore = Number(row.homeScore) || 0
      const aScore = Number(row.awayScore) || 0
      if (hScore > 0 && aScore > 0) {
        if (!pointsAgainstMap[row.homeTeamName]) {
          pointsAgainstMap[row.homeTeamName] = 0
          gamesCountMap[row.homeTeamName] = 0
        }
        if (!pointsAgainstMap[row.awayTeamName]) {
          pointsAgainstMap[row.awayTeamName] = 0
          gamesCountMap[row.awayTeamName] = 0
        }
        pointsAgainstMap[row.homeTeamName] += aScore
        gamesCountMap[row.homeTeamName] += 1
        pointsAgainstMap[row.awayTeamName] += hScore
        gamesCountMap[row.awayTeamName] += 1
      }
    })

    let unluckiestTarget = null
    Object.keys(pointsAgainstMap).forEach(m => {
      const totalPA = pointsAgainstMap[m]
      const count = gamesCountMap[m]
      if (count >= 20) {
        const avgPA = totalPA / count
        if (!unluckiestTarget || avgPA > unluckiestTarget.avgPA) {
          unluckiestTarget = { manager: m, avgPA, count }
        }
      }
    })

    if (unluckiestTarget) {
      facts.push({
        id: 'unluckiest_defensive_target',
        category: 'Records',
        badge: '#f43f5e',
        title: '🛡️ The Defensive Target (Highest PA)',
        description: `${unluckiestTarget.manager} has faced the toughest opponent scoring in league history, taking an average of ${unluckiestTarget.avgPA.toFixed(2)} Points Against per game across ${unluckiestTarget.count} matchups!`,
        stats: `${unluckiestTarget.avgPA.toFixed(2)} Points Against PPG`,
        managers: [unluckiestTarget.manager]
      })
    }
  }

  // 22. Most Century Club Games (100+ Point Games)
  if (matchLog.length > 0) {
    const centuryMap = {}
    matchLog.forEach(row => {
      const hScore = Number(row.homeScore) || 0
      const aScore = Number(row.awayScore) || 0
      if (hScore >= 100) {
        centuryMap[row.homeTeamName] = (centuryMap[row.homeTeamName] || 0) + 1
      }
      if (aScore >= 100) {
        centuryMap[row.awayTeamName] = (centuryMap[row.awayTeamName] || 0) + 1
      }
    })
    let centuryKing = null
    Object.keys(centuryMap).forEach(m => {
      const count = centuryMap[m]
      if (!centuryKing || count > centuryKing.count) {
        centuryKing = { manager: m, count }
      }
    })
    if (centuryKing) {
      facts.push({
        id: 'century_club_king',
        category: 'Records',
        badge: '#d97706',
        title: '💯 Century Club Leader',
        description: `${centuryKing.manager} leads all managers in league history with ${centuryKing.count} individual games scoring 100+ points!`,
        stats: `${centuryKing.count} 100+ Pt Games`,
        managers: [centuryKing.manager]
      })
    }
  }

  // 23. Most Postseason Playoff Rematches Between Two Teams
  if (matchLog.length > 0) {
    const playoffRematchMap = {}
    matchLog.forEach(row => {
      if (row.game_type && String(row.game_type).toLowerCase().includes('playoff')) {
        const m1 = row.homeTeamName
        const m2 = row.awayTeamName
        if (m1 && m2 && m1 !== m2) {
          const pairKey = [m1, m2].sort().join(' vs ')
          playoffRematchMap[pairKey] = (playoffRematchMap[pairKey] || 0) + 1
        }
      }
    })
    let topPlayoffRematch = null
    Object.keys(playoffRematchMap).forEach(pair => {
      const count = playoffRematchMap[pair]
      if (!topPlayoffRematch || count > topPlayoffRematch.count) {
        topPlayoffRematch = { pair, count, managers: pair.split(' vs ') }
      }
    })
    if (topPlayoffRematch && topPlayoffRematch.count >= 2) {
      facts.push({
        id: 'playoff_rematch_foes',
        category: 'Playoffs',
        badge: '#818cf8',
        title: '🥊 Postseason Rematch Foes',
        description: `${topPlayoffRematch.managers[0]} and ${topPlayoffRematch.managers[1]} have clashed in high-stakes Playoff matchups ${topPlayoffRematch.count} times in league history!`,
        stats: `${topPlayoffRematch.count} Playoff Matchups`,
        managers: topPlayoffRematch.managers
      })
    }
  }

  // 24. Single Season Regular Season Win Total Record
  if (perManager.length > 0) {
    const sortedWinPct = [...perManager].sort((a, b) => (b.regular_season_win_pct || 0) - (a.regular_season_win_pct || 0))
    if (sortedWinPct.length > 0) {
      const m = sortedWinPct[0]
      facts.push({
        id: 'win_total_king',
        category: 'Records',
        badge: '#d97706',
        title: '👑 Regular Season All-Time Win Leader',
        description: `${m.manager} has amassed the most total regular season wins in league history with a career ${m.all_time_record} record!`,
        stats: `${m.all_time_record} All-Time Record`,
        managers: [m.manager]
      })
    }
  }

  // 25. Career Scoring King (Highest Total All-Time Points)
  if (perManager.length > 0) {
    const sortedTotalPts = [...perManager].sort((a, b) => (b.total_points_scored || b.all_time_pf || 0) - (a.total_points_scored || a.all_time_pf || 0))
    if (sortedTotalPts.length > 0 && (sortedTotalPts[0].total_points_scored || sortedTotalPts[0].all_time_pf)) {
      const topPts = sortedTotalPts[0]
      const pts = Number(topPts.total_points_scored || topPts.all_time_pf).toLocaleString('en-US', { maximumFractionDigits: 1 })
      facts.push({
        id: 'career_scoring_king',
        category: 'Records',
        badge: '#d97706',
        title: '👑 Career Points Scoring King',
        description: `${topPts.manager} sits atop the all-time leaderboard as the highest career point scorer in league history with ${pts} cumulative points!`,
        stats: `${pts} All-Time Career PTS`,
        managers: [topPts.manager]
      })
    }
  }

  // 26. Offensive Juggernaut (120+ Point Games)
  if (matchLog.length > 0) {
    const juggernautMap = {}
    matchLog.forEach(row => {
      const hScore = Number(row.homeScore) || 0
      const aScore = Number(row.awayScore) || 0
      if (hScore >= 120) juggernautMap[row.homeTeamName] = (juggernautMap[row.homeTeamName] || 0) + 1
      if (aScore >= 120) juggernautMap[row.awayTeamName] = (juggernautMap[row.awayTeamName] || 0) + 1
    })
    let topJuggernaut = null
    Object.keys(juggernautMap).forEach(m => {
      const count = juggernautMap[m]
      if (!topJuggernaut || count > topJuggernaut.count) {
        topJuggernaut = { manager: m, count }
      }
    })
    if (topJuggernaut) {
      facts.push({
        id: 'offensive_juggernaut',
        category: 'Records',
        badge: '#d97706',
        title: '🔥 Offensive Juggernaut (120+ PTS)',
        description: `${topJuggernaut.manager} leads the league in explosive offensive performances with ${topJuggernaut.count} individual games scoring 120+ points!`,
        stats: `${topJuggernaut.count} Games with 120+ PTS`,
        managers: [topJuggernaut.manager]
      })
    }
  }

  // 27. Defensive Fortress (Sub-80 Allowed Games)
  if (matchLog.length > 0) {
    const fortressMap = {}
    matchLog.forEach(row => {
      const hScore = Number(row.homeScore) || 0
      const aScore = Number(row.awayScore) || 0
      if (hScore > 0 && aScore > 0) {
        if (aScore < 80) fortressMap[row.homeTeamName] = (fortressMap[row.homeTeamName] || 0) + 1
        if (hScore < 80) fortressMap[row.awayTeamName] = (fortressMap[row.awayTeamName] || 0) + 1
      }
    })
    let topFortress = null
    Object.keys(fortressMap).forEach(m => {
      const count = fortressMap[m]
      if (!topFortress || count > topFortress.count) {
        topFortress = { manager: m, count }
      }
    })
    if (topFortress) {
      facts.push({
        id: 'defensive_fortress',
        category: 'Records',
        badge: '#818cf8',
        title: '🛡️ Defensive Lockdown Master',
        description: `${topFortress.manager} has held opponents to under 80 points in ${topFortress.count} separate games, the most defensive lockdowns in league history!`,
        stats: `${topFortress.count} Sub-80 Opponent Games`,
        managers: [topFortress.manager]
      })
    }
  }

  // 28. Close Game Master (Wins by < 5 points)
  if (matchLog.length > 0) {
    const closeWinMap = {}
    matchLog.forEach(row => {
      const hScore = Number(row.homeScore) || 0
      const aScore = Number(row.awayScore) || 0
      if (hScore > 0 && aScore > 0 && hScore !== aScore) {
        const diff = Math.abs(hScore - aScore)
        if (diff < 5) {
          const winner = hScore > aScore ? row.homeTeamName : row.awayTeamName
          closeWinMap[winner] = (closeWinMap[winner] || 0) + 1
        }
      }
    })
    let topCloseMaster = null
    Object.keys(closeWinMap).forEach(m => {
      const count = closeWinMap[m]
      if (!topCloseMaster || count > topCloseMaster.count) {
        topCloseMaster = { manager: m, count }
      }
    })
    if (topCloseMaster) {
      facts.push({
        id: 'close_game_master',
        category: 'Records',
        badge: '#d97706',
        title: '🎯 Ice-in-the-Veins (Nailbiter Wins)',
        description: `${topCloseMaster.manager} is the king of close finishes, winning ${topCloseMaster.count} separate matchups decided by less than 5 points!`,
        stats: `${topCloseMaster.count} Wins < 5 PTS Margin`,
        managers: [topCloseMaster.manager]
      })
    }
  }

  // 29. High-Octane Shootout Master (Both Teams 110+ PTS)
  if (matchLog.length > 0) {
    const shootoutMap = {}
    matchLog.forEach(row => {
      const hScore = Number(row.homeScore) || 0
      const aScore = Number(row.awayScore) || 0
      if (hScore >= 110 && aScore >= 110) {
        shootoutMap[row.homeTeamName] = (shootoutMap[row.homeTeamName] || 0) + 1
        shootoutMap[row.awayTeamName] = (shootoutMap[row.awayTeamName] || 0) + 1
      }
    })
    let topShootout = null
    Object.keys(shootoutMap).forEach(m => {
      const count = shootoutMap[m]
      if (!topShootout || count > topShootout.count) {
        topShootout = { manager: m, count }
      }
    })
    if (topShootout) {
      facts.push({
        id: 'shootout_master',
        category: 'Records',
        badge: '#d97706',
        title: '🔥 High-Octane Shootout Veteran',
        description: `${topShootout.manager} has been involved in ${topShootout.count} high-scoring shootouts where both teams scored over 110 points!`,
        stats: `${topShootout.count} Dual 110+ Pt Matchups`,
        managers: [topShootout.manager]
      })
    }
  }

  // 30. Postseason Podium Finish Leader
  if (playoff.length > 0) {
    const podiumMap = playoff.map(p => {
      const podiums = (p.championship_wins || 0) + (p.runner_up_finishes || 0) + (p.third_place_finishes || 0)
      return { manager: p.manager, podiums, titles: p.championship_wins || 0 }
    }).sort((a, b) => b.podiums - a.podiums)
    if (podiumMap.length > 0 && podiumMap[0].podiums > 0) {
      const topPodium = podiumMap[0]
      facts.push({
        id: 'podium_leader',
        category: 'Playoffs',
        badge: '#d97706',
        title: '🏅 Postseason Podium Leader',
        description: `${topPodium.manager} has finished on the league postseason podium (Top 3 finish) a record ${topPodium.podiums} times!`,
        stats: `${topPodium.podiums} Top-3 Podium Finishes`,
        managers: [topPodium.manager]
      })
    }
  }

  // 31. Championship Final Highest Winning Score
  if (matchLog.length > 0) {
    let topFinalScore = null
    matchLog.forEach(row => {
      const isFinal = row.game_type && (String(row.game_type).toLowerCase().includes('championship') || String(row.game_type).toLowerCase().includes('final'))
      if (isFinal) {
        const hScore = Number(row.homeScore) || 0
        const aScore = Number(row.awayScore) || 0
        const maxScore = Math.max(hScore, aScore)
        const winner = hScore > aScore ? row.homeTeamName : row.awayTeamName
        if (!topFinalScore || maxScore > topFinalScore.score) {
          topFinalScore = { winner, score: maxScore, season: row.season }
        }
      }
    })
    if (topFinalScore) {
      facts.push({
        id: 'championship_high_score',
        category: 'Playoffs',
        badge: '#d97706',
        title: '🏆 Championship Game Scoring High',
        description: `${topFinalScore.winner} erupted for a League Finals record score of ${topFinalScore.score.toFixed(2)} points in the ${topFinalScore.season} Championship!`,
        stats: `${topFinalScore.score.toFixed(2)} PTS in Finals`,
        managers: [topFinalScore.winner]
      })
    }
  }

  // 32. Heavy Hitter Win Margin (30+ Point Blowouts)
  if (matchLog.length > 0) {
    const blowoutCountMap = {}
    matchLog.forEach(row => {
      const hScore = Number(row.homeScore) || 0
      const aScore = Number(row.awayScore) || 0
      if (hScore > 0 && aScore > 0) {
        const diff = Math.abs(hScore - aScore)
        if (diff >= 30) {
          const winner = hScore > aScore ? row.homeTeamName : row.awayTeamName
          blowoutCountMap[winner] = (blowoutCountMap[winner] || 0) + 1
        }
      }
    })
    let topBlowoutKing = null
    Object.keys(blowoutCountMap).forEach(m => {
      const count = blowoutCountMap[m]
      if (!topBlowoutKing || count > topBlowoutKing.count) {
        topBlowoutKing = { manager: m, count }
      }
    })
    if (topBlowoutKing) {
      facts.push({
        id: 'heavy_hitter_blowouts',
        category: 'Records',
        badge: '#f43f5e',
        title: '💥 30-Point Blowout Heavy Hitter',
        description: `${topBlowoutKing.manager} holds the league record for most 30+ point blowout wins with ${topBlowoutKing.count} absolute dominant victories!`,
        stats: `${topBlowoutKing.count} Blowout Wins (30+ PTS)`,
        managers: [topBlowoutKing.manager]
      })
    }
  }

  // 33. Playoff Win Margin Leader
  if (matchLog.length > 0) {
    let topPlayoffBlowout = null
    matchLog.forEach(row => {
      const isPlayoff = row.game_type && String(row.game_type).toLowerCase().includes('playoff')
      if (isPlayoff) {
        const hScore = Number(row.homeScore) || 0
        const aScore = Number(row.awayScore) || 0
        if (hScore > 0 && aScore > 0) {
          const diff = Math.abs(hScore - aScore)
          if (!topPlayoffBlowout || diff > topPlayoffBlowout.diff) {
            const winner = hScore > aScore ? row.homeTeamName : row.awayTeamName
            const loser = hScore > aScore ? row.awayTeamName : row.homeTeamName
            topPlayoffBlowout = { winner, loser, diff, season: row.season, week: row.week }
          }
        }
      }
    })
    if (topPlayoffBlowout) {
      facts.push({
        id: 'playoff_blowout_king',
        category: 'Playoffs',
        badge: '#818cf8',
        title: '⚡ Postseason Blowout Record',
        description: `In the ${topPlayoffBlowout.season} playoffs (Week ${topPlayoffBlowout.week}), ${topPlayoffBlowout.winner} set the playoff blowout record by defeating ${topPlayoffBlowout.loser} by ${topPlayoffBlowout.diff.toFixed(2)} points!`,
        stats: `+${topPlayoffBlowout.diff.toFixed(2)} Margin Victory`,
        managers: [topPlayoffBlowout.winner, topPlayoffBlowout.loser]
      })
    }
  }

  // 34. Most Consistent Scoring (Lowest Scoring Variance/Highest Floor)
  if (perManager.length > 0) {
    const highFloorManagers = [...perManager]
      .filter(m => (m.lowest_score || 0) > 0)
      .sort((a, b) => (b.lowest_score || 0) - (a.lowest_score || 0))
    if (highFloorManagers.length > 0) {
      const topFloor = highFloorManagers[0]
      facts.push({
        id: 'highest_scoring_floor',
        category: 'Records',
        badge: '#d97706',
        title: '📊 Highest Scoring Floor in History',
        description: `${topFloor.manager} holds the highest single-game score floor in league history — even on their worst week ever recorded, they still posted ${topFloor.lowest_score} points!`,
        stats: `${topFloor.lowest_score} PTS Career Lowest Score`,
        managers: [topFloor.manager]
      })
    }
  }

  return facts
}

const FunFactGenerator = ({ excelData, setActiveManagerProfile }) => {
  const allFacts = useMemo(() => generateFunFacts(excelData), [excelData])
  const [spotlightIndex, setSpotlightIndex] = useState(0)
  const [isSpinning, setIsSpinning] = useState(false)

  const currentSpotlight = allFacts[spotlightIndex] || allFacts[0]

  const handleNextSpotlight = () => {
    if (!allFacts || allFacts.length <= 1) return
    setIsSpinning(true)
    setTimeout(() => {
      let nextIndex = spotlightIndex
      while (nextIndex === spotlightIndex) {
        nextIndex = Math.floor(Math.random() * allFacts.length)
      }
      setSpotlightIndex(nextIndex)
      setIsSpinning(false)
    }, 300)
  }

  if (!allFacts || allFacts.length === 0 || !currentSpotlight) return null

  return (
    <div 
      style={{
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        borderLeft: '4px solid var(--accent-blue)',
        padding: '0.85rem 1.15rem',
        position: 'relative',
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.15)',
        transition: 'all 0.3s ease',
        marginBottom: '1.25rem'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.4rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span 
            style={{ 
              backgroundColor: 'rgba(217, 119, 6, 0.12)', 
              color: 'var(--accent-blue)', 
              fontSize: '0.65rem', 
              fontWeight: '800', 
              padding: '0.15rem 0.45rem', 
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              border: '1px solid rgba(217, 119, 6, 0.3)'
            }}
          >
            {currentSpotlight.category}
          </span>
          <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: '800', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {currentSpotlight.title}
          </h3>
        </div>

        <button
          onClick={handleNextSpotlight}
          disabled={isSpinning}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.45rem',
            backgroundColor: 'var(--accent-blue)',
            border: 'none',
            color: '#090b0e',
            padding: '0.45rem 0.95rem',
            fontSize: '0.85rem',
            fontWeight: '800',
            cursor: 'pointer',
            boxShadow: '0 3px 12px rgba(217, 119, 6, 0.3)',
            transition: 'transform 0.15s ease, background-color 0.15s ease'
          }}
          onMouseDown={e => e.currentTarget.style.transform = 'scale(0.95)'}
          onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
        >
          <RefreshCw size={15} style={{ animation: isSpinning ? 'spin 0.6s linear infinite' : 'none' }} />
          <span>Spin Fact 🎲</span>
        </button>
      </div>

      <p style={{ fontSize: '0.85rem', lineHeight: '1.45', color: 'var(--text-primary)', margin: '0 0 0.5rem 0', fontWeight: '500' }}>
        {currentSpotlight.description}
      </p>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', borderTop: '1px dashed rgba(255,255,255,0.06)', paddingTop: '0.4rem' }}>
        <div style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--accent-green)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <Zap size={12} color="var(--accent-green)" />
          {currentSpotlight.stats}
        </div>

        {currentSpotlight.managers && currentSpotlight.managers.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Managers:</span>
            {currentSpotlight.managers.map(m => (
              <button
                key={m}
                onClick={() => setActiveManagerProfile && setActiveManagerProfile(m)}
                style={{
                  backgroundColor: 'rgba(253, 230, 138, 0.12)',
                  border: '1px solid rgba(253, 230, 138, 0.4)',
                  color: '#fde68a',
                  fontSize: '0.75rem',
                  fontWeight: '700',
                  padding: '0.2rem 0.5rem',
                  borderRadius: '0.375rem',
                  cursor: 'pointer'
                }}
              >
                👤 {m}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const COLUMN_HEADER_MAP = {
  'awayTeamName': 'Away Team',
  'homeTeamName': 'Home Team',
  'awayScore': 'Away Score',
  'homeScore': 'Home Score',
  'game_type': 'Game Type',
  'avg_points_per_game': 'Avg PF / Game',
  'total_points': 'Total Points For',
  'games_played': 'Games Played',
  'regular_season_win_pct': 'Reg Win %',
  'playoff_win_pct': 'Playoff Win %',
  'all_time_record': 'All-Time Record',
  'total_games': 'Total Games',
  'highest_score': 'High Score',
  'lowest_score': 'Low Score',
  'week1_record': 'Week 1 Record',
  'playoff_appearances': 'Playoff Apps',
  'playoff_games': 'Playoff Games',
  'playoff_wins': 'Playoff Wins',
  'playoff_losses': 'Playoff Losses',
  'round2_appearances': 'Round 2 Apps',
  'championship_appearances': 'Champ Apps',
  'championship_wins': 'Champ Wins',
  'pick_no': 'Pick #',
  'player_name': 'Player Drafted',
  'position': 'Pos',
  'team': 'NFL Team'
}

export default function App() {
  const [activeTab, setActiveTab] = useState('home')
  const [liveData, setLiveData] = useState(null)
  const [excelData, setExcelData] = useState(null)
  const [selectedWeek, setSelectedWeek] = useState(1)
  const [excelSheet, setExcelSheet] = useState('PerManagerSummary')
  
  // Record Book Filtering & Sorting
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedSeasonFilter, setSelectedSeasonFilter] = useState('ALL')
  const [selectedGameTypeFilter, setSelectedGameTypeFilter] = useState('ALL')
  const [selectedManagerFilter, setSelectedManagerFilter] = useState('ALL')
  
  const [sortColumn, setSortColumn] = useState(null)
  const [sortDirection, setSortDirection] = useState('asc')
  
  // Selected Calendar Photo Modal
  const [activePhotoMonth, setActivePhotoMonth] = useState(null)
  const [top10Mode, setTop10Mode] = useState('incl') // 'incl' or 'reg'
  const [h2hMode, setH2hMode] = useState('reg') // 'reg' or 'incl'

  // Playoff Simulator State (defaults come from the validated live model).
  const [simModel, setSimModel] = useState('Bayesian')
  const [simPriorStd, setSimPriorStd] = useState(SIMULATION_MODEL.priorStd)
  const [simMinSigma, setSimMinSigma] = useState(SIMULATION_MODEL.minSigma)
  const [simCount, setSimCount] = useState(10000)
  const [simOverrides, setSimOverrides] = useState({})
  const [simResults, setSimResults] = useState(null)
  const [isSimulating, setIsSimulating] = useState(false)

  // Standings View Toggle ('actual' vs 'luck')
  const [standingsView, setStandingsView] = useState('actual')

  // Clipboard Copy Toast Feedback State
  const [copiedToast, setCopiedToast] = useState(null) // null | 'league' | 'upcoming'

  // Active Manager Profile Modal State
  const [activeManagerProfile, setActiveManagerProfile] = useState(null)

  // Sleeper projections for the selected matchup week, keyed by player ID.
  const [weeklyProjections, setWeeklyProjections] = useState({})
  const [weeklyProjectionTeams, setWeeklyProjectionTeams] = useState({})
  const [weeklyGameStatuses, setWeeklyGameStatuses] = useState({})

  // H2H View Toggle ('list' vs 'matrix')
  const [h2hDisplayMode, setH2hDisplayMode] = useState('matrix')

  useEffect(() => {
    const fetchData = () => {
      Promise.all([
        fetch('/data/live_sleeper_data.json').then(r => {
          if (!r.ok) throw new Error("Could not load live_sleeper_data.json")
          return r.json()
        }),
        fetch('/data/excel_history.json').then(r => {
          if (!r.ok) throw new Error("Could not load excel_history.json")
          return r.json()
        }),
        fetch('https://api.sleeper.app/v1/league/1389388845572702208').then(r => r.json()).catch(() => ({})),
        fetch('https://api.sleeper.app/v1/league/1389388845572702208/rosters').then(r => r.json()).catch(() => [])
      ])
        .then(async ([live, excel, sleeperLeague, sleeperRosters]) => {
          if (excel && excel.Sheet1) {
            delete excel.Sheet1
          }

          const curWk = resolveCurrentWeek(sleeperLeague, live?.current_week)
          
          // Fetch live matchup points for weeks 1..curWk from Sleeper API
          const matchupPromises = []
          for (let w = 1; w <= 14; w++) {
            matchupPromises.push(
              fetch(`https://api.sleeper.app/v1/league/1389388845572702208/matchups/${w}`)
                .then(r => r.json())
                .then(data => ({ week: w, matchups: data }))
                .catch(() => ({ week: w, matchups: [] }))
            )
          }
          const allWeekMatchups = await Promise.all(matchupPromises)

          allWeekMatchups.forEach(({ week, matchups }) => {
            if (Array.isArray(matchups) && matchups.length > 0 && live) {
              const matchupMap = {}
              matchups.forEach(m => {
                matchupMap[String(m.roster_id)] = m
              })

              const applyPts = (targetObj) => {
                if (!targetObj || !targetObj[String(week)]) return
                const list = targetObj[String(week)]
                list.forEach(item => {
                  if (Array.isArray(item)) {
                    item.forEach(subItem => {
                      const liveMatchup = subItem && matchupMap[String(subItem.roster_id)]
                      if (liveMatchup) {
                        subItem.points = liveMatchup.points || 0
                        subItem.starters = liveMatchup.starters || subItem.starters
                        subItem.players = liveMatchup.players || subItem.players
                        subItem.starters_points = liveMatchup.starters_points || subItem.starters_points
                        subItem.players_points = liveMatchup.players_points || subItem.players_points
                      }
                    })
                  } else {
                    const liveMatchup = item && matchupMap[String(item.roster_id)]
                    if (liveMatchup) {
                      item.points = liveMatchup.points || 0
                      item.starters = liveMatchup.starters || item.starters
                      item.players = liveMatchup.players || item.players
                      item.starters_points = liveMatchup.starters_points || item.starters_points
                      item.players_points = liveMatchup.players_points || item.players_points
                    }
                  }
                })
              }

              applyPts(live.matchups_by_week)
              applyPts(live.matchups)
            }
          })

          // Extract custom 2026 division names from Sleeper API metadata
          const divNameMap = {
            1: sleeperLeague?.metadata?.division_1 || 'Division 1',
            2: sleeperLeague?.metadata?.division_2 || 'Division 2',
            3: sleeperLeague?.metadata?.division_3 || 'Division 3'
          }
          live.division_names = divNameMap

          // Merge live standings & points_for from Sleeper rosters API
          if (Array.isArray(sleeperRosters) && sleeperRosters.length > 0 && live && live.standings) {
            const rosterDataMap = {}
            sleeperRosters.forEach(r => {
              const pf = r.settings ? (r.settings.fpts + (r.settings.fpts_decimal || 0) / 100) : 0
              const wins = r.settings ? r.settings.wins : 0
              const losses = r.settings ? r.settings.losses : 0
              const ties = r.settings ? (r.settings.ties || 0) : 0
              rosterDataMap[String(r.roster_id)] = { pf, wins, losses, ties }
            })

            live.standings.forEach(s => {
              const rInfo = rosterDataMap[String(s.roster_id)]
              if (rInfo) {
                s.points_for = rInfo.pf
                s.wins = rInfo.wins
                s.losses = rInfo.losses
                s.ties = rInfo.ties
                s.division_name = divNameMap[s.division] || `Division ${s.division}`
              }
            })

            // Sort standings: Wins desc, then PF desc
            live.standings.sort((a, b) => (b.wins - a.wins) || (b.points_for - a.points_for))
            
            // Re-assign rank numbers 1..12
            live.standings.forEach((team, idx) => {
              team.rank = idx + 1
            })

            // Re-generate Punishment Watch (Bottom 3)
            live.punishment_watch = live.standings.slice(-3).reverse()

            // Re-generate Playoff Picture (Top 6)
            // Rules: Seeds 1-3 are Division Leaders (highest W-L then PF per division) sorted among themselves by W-L then PF
            const divisions = {}
            live.standings.forEach(team => {
              const div = team.division || 1
              if (!divisions[div] || (team.wins > divisions[div].wins) || (team.wins === divisions[div].wins && team.points_for > divisions[div].points_for)) {
                divisions[div] = team
              }
            })

            const divLeaders = Object.values(divisions).sort((a, b) => (b.wins - a.wins) || (b.points_for - a.points_for))
            const divLeaderRosterIds = new Set(divLeaders.map(t => t.roster_id))

            // Non-division leaders sorted by record then PF
            const nonDivLeaders = live.standings.filter(t => !divLeaderRosterIds.has(t.roster_id))
            
            // Seed 4: Wildcard (Best record among non-div leaders)
            const seed4 = nonDivLeaders[0]

            // Seeds 5 & 6: Highest PF among remaining non-div leaders
            const remainingNonDiv = nonDivLeaders.slice(1).sort((a, b) => b.points_for - a.points_for)
            const seed5 = remainingNonDiv[0]
            const seed6 = remainingNonDiv[1]

            live.playoff_picture = [
              { seed: 1, type: `${divNameMap[divLeaders[0]?.division] || 'Division Leader'}`, team: divLeaders[0] },
              { seed: 2, type: `${divNameMap[divLeaders[1]?.division] || 'Division Leader'}`, team: divLeaders[1] },
              { seed: 3, type: `${divNameMap[divLeaders[2]?.division] || 'Division Leader'}`, team: divLeaders[2] },
              { seed: 4, type: "Wildcard (Record)", team: seed4 },
              { seed: 5, type: "Points For Qualifier", team: seed5 },
              { seed: 6, type: "Points For Qualifier", team: seed6 }
            ].filter(p => p.team)
          }

          if (curWk) {
            live.current_week = curWk
          }
          setLiveData(live)
          setExcelData(excel)
          if (curWk) {
            setSelectedWeek(curWk)
          }

          // Automatically compute baseline 5,000-iteration Bayesian Playoff Simulation
          if (live.standings) {
            const managerProxies = (excel.PerManagerSummary || []);
            const completedScores = collectCompletedWeeklyScores(live.matchups_by_week, curWk);
            const simTeams = live.standings.map(s => {
              const proxy = managerProxies.find(m => m.manager === s.canonical_name);
              return {
                name: s.canonical_name,
                wins: s.wins || 0,
                losses: s.losses || 0,
                fpts: s.points_for || 0,
                division: s.division || 1,
                weeklyScores: completedScores[s.canonical_name] || [],
                historicalAvg: proxy ? Math.max(100.0, proxy.highest_score * 0.7) : 110.0
              };
            });

            const remainingSched = [];
            const matchupsByWk = live.matchups_by_week || {};
            Object.keys(matchupsByWk).forEach(wkStr => {
              if (Number(wkStr) >= curWk) {
                (matchupsByWk[wkStr] || []).forEach(pair => {
                  if (pair.length >= 2) {
                    const away = pair[0].team_info?.canonical_name;
                    const home = pair[1].team_info?.canonical_name;
                    if (away && home) remainingSched.push([away, home]);
                  }
                });
              }
            });

            const autoRes = runPlayoffSimulation({
              teams: simTeams,
              remainingSchedule: remainingSched,
              simulations: 10000,
              model: 'Bayesian',
              priorStd: SIMULATION_MODEL.priorStd,
              minSigma: SIMULATION_MODEL.minSigma,
              scoreModel: SIMULATION_MODEL.scoreModel,
              weeklySigma: SIMULATION_MODEL.weeklySigma,
              volatilityPriorGames: SIMULATION_MODEL.volatilityPriorGames,
              overrides: {},
              divisions: live.divisions || {}
            });
            setSimResults(autoRes);
          }
        })
        .catch(err => {
          console.error("Error loading JSON data:", err)
        })
    }

    fetchData()

    // 1-Minute Live Auto-Refresh Polling
    const interval = setInterval(() => {
      if (!document.hidden) {
        fetchData()
      }
    }, 60000)

    return () => clearInterval(interval)
  }, [])

  const selectedWeekStarters = (liveData?.matchups_by_week?.[String(selectedWeek)] || [])
    .flatMap(pair => Array.isArray(pair) ? pair : [pair])
    .flatMap(team => team?.starters || [])
    .map(String)
    .sort()
  const selectedWeekStarterKey = selectedWeekStarters.join(',')
  const selectedWeekScoreKey = (liveData?.matchups_by_week?.[String(selectedWeek)] || [])
    .flatMap(pair => Array.isArray(pair) ? pair : [pair])
    .map(team => `${team?.roster_id || ''}:${Number(team?.points || 0).toFixed(2)}`)
    .join(',')

  useEffect(() => {
    if (!liveData?.season || !selectedWeekStarterKey) return
    const weekKey = String(selectedWeek)
    let cancelled = false
    const params = new URLSearchParams({ season_type: 'regular' })
    ;['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].forEach(position => params.append('position[]', position))

    Promise.all([
      fetch(`https://api.sleeper.com/projections/nfl/${liveData.season}/${selectedWeek}?${params}`).then(response => {
        if (!response.ok) throw new Error(`Sleeper projections returned ${response.status}`)
        return response.json()
      }),
      fetch(`https://api.sleeper.app/schedule/nfl/regular/${liveData.season}`).then(response => {
        if (!response.ok) throw new Error(`Sleeper schedule returned ${response.status}`)
        return response.json()
      }).catch(() => [])
    ])
      .then(([rows, schedule]) => {
        if (cancelled) return
        const lookup = buildProjectionLookup(rows, selectedWeekStarters, liveData.scoring_settings || {})
        const playerTeams = buildProjectionTeamLookup(rows, selectedWeekStarters)
        const statuses = {}
        ;(schedule || []).filter(game => Number(game.week) === Number(selectedWeek)).forEach(game => {
          if (game.home) statuses[String(game.home)] = game.status || 'pre_game'
          if (game.away) statuses[String(game.away)] = game.status || 'pre_game'
        })
        setWeeklyProjections(current => ({ ...current, [weekKey]: lookup }))
        setWeeklyProjectionTeams(current => ({ ...current, [weekKey]: playerTeams }))
        setWeeklyGameStatuses(current => ({ ...current, [weekKey]: statuses }))
      })
      .catch(error => {
        if (!cancelled) console.warn(`Could not load Sleeper Week ${selectedWeek} projections:`, error)
      })

    return () => {
      cancelled = true
    }
  }, [liveData?.season, selectedWeek, selectedWeekStarterKey, selectedWeekScoreKey])

  if (!liveData || !excelData) {
    return (
      <div className="app-container" style={{ textAlign: 'center', paddingTop: '5rem' }}>
        <h2 style={{ color: 'var(--text-secondary)' }}>Loading Blaj League Data...</h2>
      </div>
    )
  }

  // Calculate H2H record for two managers from MatchLog
  const getH2HRecord = (managerA, managerB) => {
    if (!excelData || !excelData.MatchLog_PlayoffIncluded) return "First Ever Meeting"
    const matchLog = excelData.MatchLog_PlayoffIncluded
    let aWins = 0
    let bWins = 0
    let ties = 0

    matchLog.forEach(m => {
      const away = (m.awayTeamName || '').toLowerCase()
      const home = (m.homeTeamName || '').toLowerCase()
      const ma = (managerA || '').toLowerCase()
      const mb = (managerB || '').toLowerCase()

      if ((away.includes(ma) && home.includes(mb)) || (away.includes(mb) && home.includes(ma))) {
        if (m.winner) {
          const w = m.winner.toLowerCase()
          if (w.includes(ma)) aWins++
          else if (w.includes(mb)) bWins++
        } else if (m.tie) {
          ties++
        }
      }
    })

    if (aWins === 0 && bWins === 0 && ties === 0) return "First Ever Meeting"
    if (aWins > bWins) return `${managerA} leads ${aWins}-${bWins}`
    if (bWins > aWins) return `${managerB} leads ${bWins}-${aWins}`
    return `Tied ${aWins}-${bWins}`
  }

  // 1. One-Button Copy: State of the League (Playoff Picture, Punishment Watch, Highlights, Simulation Odds)
  const copyStateOfLeagueSummary = () => {
    const curWk = liveData?.current_week || 1
    let text = `*BLAJ - STATE OF THE LEAGUE (WEEK ${curWk - 1 > 0 ? curWk - 1 : 1} COMPLETE)*\n\n`

    // Playoff Picture
    text += `*Playoff Picture:*\n`
    ;(liveData?.playoff_picture || []).forEach(p => {
      const name = p.team?.team_name || p.team?.canonical_name
      const w = p.team?.wins || 0
      const l = p.team?.losses || 0
      const pf = (p.team?.points_for || 0).toFixed(2)
      text += `${p.seed}. *${name}* (${w}-${l}, ${pf})\n`
    })

    // Punishment Watch
    text += `\n*Punishment Watch:*\n`
    ;(liveData?.punishment_watch || []).forEach(t => {
      const name = t.team_name || t.canonical_name
      const w = t.wins || 0
      const l = t.losses || 0
      const pf = (t.points_for || 0).toFixed(2)
      text += `${t.rank}. *${name}* (${w}-${l}, ${pf})\n`
    })

    // Newly broken or updated records from last week
    const lastWkNum = curWk - 1 > 0 ? curWk - 1 : 1
    const matchLog = excelData?.MatchLog_PlayoffIncluded || []
    const lastWkGames = matchLog.filter(m => m.season === 2026 && Number(m.week) === lastWkNum)

    const updatedFacts = []

    lastWkGames.forEach(g => {
      const hScore = Number(g.homeScore) || 0
      const aScore = Number(g.awayScore) || 0
      const maxScore = Math.max(hScore, aScore)
      const minScore = Math.min(hScore, aScore)
      const margin = Math.abs(hScore - aScore)
      const winner = hScore > aScore ? g.homeTeamName : g.awayTeamName
      const loser = hScore > aScore ? g.awayTeamName : g.homeTeamName

      if (maxScore >= 135) {
        updatedFacts.push(`- High Scoring Milestone: *${winner}* posted ${maxScore.toFixed(2)} PTS in Week ${lastWkNum}`)
      }
      if (margin >= 30) {
        updatedFacts.push(`- Blowout Victory: *${winner}* defeated *${loser}* by ${margin.toFixed(2)} PTS`)
      }
      if (margin <= 2.5 && margin > 0) {
        updatedFacts.push(`- Nail-biter Finish: *${winner}* edged out *${loser}* by just ${margin.toFixed(2)} PTS (${maxScore.toFixed(2)} - ${minScore.toFixed(2)})`)
      }
    })

    if (updatedFacts.length > 0) {
      text += `\n*NOTABLE HIGHLIGHTS & RECORDS FROM WEEK ${lastWkNum}*\n`
      updatedFacts.forEach(f => {
        text += `${f}\n`
      })
    }

    // Playoff Odds if simulator has run
    if (simResults && simResults.length > 0) {
      const getTeamName = (canonical) => {
        const teamObj = (liveData?.standings || []).find(s => s.canonical_name === canonical)
        return teamObj ? (teamObj.team_name || teamObj.canonical_name) : canonical
      }

      text += `\n*PLAYOFF SIMULATION (${simCount.toLocaleString()} ITERATIONS)*\n`

      // 1. Playoff Odds (Sorted by Playoff % desc)
      text += `\n*Playoff Odds:*\n`
      const byPlayoff = [...simResults].sort((a, b) => (b.playoffPct - a.playoffPct) || (b.projWins - a.projWins))
      byPlayoff.forEach(r => {
        const name = getTeamName(r.name)
        const projL = (14 - r.projWins).toFixed(1)
        text += `*${name}*: ${r.playoffPct.toFixed(2)}% (${r.playoffCount.toLocaleString()}) (${r.projWins.toFixed(1)}-${projL})\n`
      })

      // 2. Bye Odds (Sorted by Bye % desc)
      text += `\n*Bye Odds:*\n`
      const byBye = [...simResults].sort((a, b) => (b.byePct - a.byePct) || (b.projWins - a.projWins))
      byBye.forEach(r => {
        const name = getTeamName(r.name)
        text += `*${name}*: ${r.byePct.toFixed(2)}%\n`
      })

      // 3. Last-Place / Sacko Odds (Sorted by Last % desc)
      text += `\n*Last-Place Odds:*\n`
      const byLast = [...simResults].sort((a, b) => (b.lastPct - a.lastPct) || (a.projWins - b.projWins))
      byLast.forEach(r => {
        const name = getTeamName(r.name)
        text += `*${name}*: ${r.lastPct.toFixed(2)}%\n`
      })
    }

    text += `\nGenerated via Blaj Fantasy Dashboard`

    navigator.clipboard.writeText(text).then(() => {
      setCopiedToast('league')
      setTimeout(() => setCopiedToast(null), 2500)
    })
  }

  // 2. One-Button Copy: Upcoming Week Outlook & Notable Historical Matchup Facts
  const copyUpcomingWeekOutlook = () => {
    const curWk = liveData?.current_week || 1
    const targetWk = selectedWeek || curWk
    const matchLog = excelData?.MatchLog_PlayoffIncluded || []
    
    // Fetch target week matchups from liveData
    const rawItems = (liveData && liveData.matchups && (liveData.matchups[targetWk] || liveData.matchups[String(targetWk)])) || 
                      (liveData && liveData.matchups_by_week && (liveData.matchups_by_week[targetWk] || liveData.matchups_by_week[String(targetWk)])) || []

    const weekMatchups = (() => {
      if (!rawItems || rawItems.length === 0) return []
      if (Array.isArray(rawItems[0])) return rawItems

      const grouped = {}
      rawItems.forEach(item => {
        const mid = item.matchup_id
        if (mid !== undefined && mid !== null) {
          if (!grouped[mid]) grouped[mid] = []
          const cName = item.canonical_name || item.display_name || `Team ${item.roster_id}`
          const tName = item.team_name || (liveData && liveData.roster_team_map && liveData.roster_team_map[String(item.roster_id)]) || cName
          const formattedItem = {
            ...item,
            points: Number(item.points || 0),
            team_info: {
              canonical_name: cName,
              team_name: tName
            }
          }
          grouped[mid].push(formattedItem)
        }
      })

      return Object.values(grouped).filter(pair => pair.length === 2)
    })()

    let text = `*BLAJ - WEEK ${targetWk} MATCHUP OUTLOOK & PREVIEW*\n\n`

    if (weekMatchups && weekMatchups.length > 0) {
      weekMatchups.forEach((pair, idx) => {
        if (pair.length >= 2) {
          const tA = pair[0].team_info
          const tB = pair[1].team_info
          const ma = tA.canonical_name
          const mb = tB.canonical_name

          const h2h = getH2HRecord(ma, mb)

          text += `MATCHUP #${idx + 1}: ${tA.team_name} vs. ${tB.team_name}\n`
          text += `  - All-Time Series: ${h2h}\n`
          
          // Search historical match log for notable historical facts between these two managers
          const historyGames = matchLog.filter(m => {
            const away = (m.awayTeamName || '').toLowerCase()
            const home = (m.homeTeamName || '').toLowerCase()
            const a = ma.toLowerCase()
            const b = mb.toLowerCase()
            return (away.includes(a) && home.includes(b)) || (away.includes(b) && home.includes(a))
          }).sort((a, b) => (b.season - a.season) || (b.week - a.week))

          if (historyGames.length > 0) {
            // Last 5 Meetings Record
            const last5Games = historyGames.slice(0, 5)
            let aLast5Wins = 0
            let bLast5Wins = 0
            last5Games.forEach(g => {
              if (g.winner) {
                const w = g.winner.toLowerCase()
                if (w.includes(ma.toLowerCase())) aLast5Wins++
                else if (w.includes(mb.toLowerCase())) bLast5Wins++
              }
            })
            const last5Text = aLast5Wins > bLast5Wins 
              ? `${ma} leads ${aLast5Wins}-${bLast5Wins}`
              : (bLast5Wins > aLast5Wins ? `${mb} leads ${bLast5Wins}-${aLast5Wins}` : `Tied ${aLast5Wins}-${bLast5Wins}`)
            text += `  - Last 5 Meetings: ${last5Text}\n`

            // Fact 1: Last meeting
            const lastG = historyGames[0]
            text += `  - Last Meeting: ${lastG.season} Week ${lastG.week} (${lastG.winner || 'Tie'} won ${Math.max(lastG.awayScore, lastG.homeScore).toFixed(2)} - ${Math.min(lastG.awayScore, lastG.homeScore).toFixed(2)})\n`

            // Fact 2: Playoff history if any
            const playoffGames = historyGames.filter(g => String(g.game_type || '').toLowerCase() === 'playoff' || g.is_championship)
            if (playoffGames.length > 0) {
              const lastP = playoffGames[0]
              text += `  - Playoff Rematch: Met in ${lastP.season} Week ${lastP.week} ${lastP.is_championship ? 'Championship' : 'Playoffs'} (${lastP.winner} won ${Math.max(lastP.awayScore, lastP.homeScore).toFixed(2)} - ${Math.min(lastP.awayScore, lastP.homeScore).toFixed(2)})\n`
            }

            // Fact 3: Closest game ever between them
            const closestG = [...historyGames].sort((a, b) => Math.abs(a.awayScore - a.homeScore) - Math.abs(b.awayScore - b.homeScore))[0]
            const closestMargin = Math.abs(closestG.awayScore - closestG.homeScore)
            if (closestMargin <= 3.0) {
              text += `  - Historical Heartbreaker: ${closestG.season} Week ${closestG.week} decided by just ${closestMargin.toFixed(2)} pts (${closestG.winner} won)\n`
            }

            // Fact 4: Biggest blowout ever between them
            const blowoutG = [...historyGames].sort((a, b) => Math.abs(b.awayScore - b.homeScore) - Math.abs(a.awayScore - a.homeScore))[0]
            const blowoutMargin = Math.abs(blowoutG.awayScore - blowoutG.homeScore)
            if (blowoutMargin >= 35.0) {
              text += `  - Biggest Blowout: ${blowoutG.season} Week ${blowoutG.week} (${blowoutG.winner} won by ${blowoutMargin.toFixed(2)} pts)\n`
            }
          }

          text += `\n`
        }
      })
    } else {
      text += `No upcoming matchups loaded for Week ${targetWk}.\n`
    }

    text += `Generated via Blaj Fantasy Dashboard`

    navigator.clipboard.writeText(text).then(() => {
      setCopiedToast('upcoming')
      setTimeout(() => setCopiedToast(null), 2500)
    })
  }

  // 3. One-Button PDF Download: one-page weekly newsletter
  const downloadPdfReport = async () => {
    try {
      await downloadWeeklyNewsletter({
        liveData,
        excelData,
        simResults,
        simCount,
        currentMatchups,
        selectedWeek,
        getH2HRecord
      })
      setCopiedToast('pdf')
      setTimeout(() => setCopiedToast(null), 2500)
    } catch (err) {
      console.error('Error generating PDF:', err)
    }
  }

  const sheetKeys = Object.keys(excelData)
    .filter(key => 
      key !== 'MatchLog_PlayoffIncluded' && 
      key !== 'Top10_Seasons_Reg' && 
      key !== 'Top10_Seasons_InclPlayoffs' &&
      key !== 'H2H_AllTime_PlayoffIncluded' &&
      key !== 'H2H_Last5_PlayoffIncluded'
    )
  
  if (excelData && !sheetKeys.includes('Top10_Seasons')) {
    sheetKeys.splice(2, 0, 'Top10_Seasons')
  }

  const handleSort = (col) => {
    if (sortColumn === col) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(col)
      setSortDirection('asc')
    }
  }

  const formatCellValue = (val, colKey) => {
    if (val === null || val === undefined) return '-'
    if (colKey === 'regular_season_win_pct' || colKey === 'playoff_win_pct' || colKey === 'win_pct') {
      return `${(val * 100).toFixed(2)}%`
    }
    if (typeof val === 'number') {
      return Number.isInteger(val) ? val : val.toFixed(2)
    }
    return String(val)
  }

  const currentSheetRows = excelData[excelSheet] || []
  
  const availableSeasons = Array.from(
    new Set(currentSheetRows.map(r => r.season).filter(Boolean))
  ).sort((a, b) => b - a)

  const availableGameTypes = Array.from(
    new Set(currentSheetRows.map(r => r.game_type).filter(Boolean))
  )

  // Clean & Deduplicated Managers List for Dropdown
  const availableManagers = Array.from(
    new Set(
      (excelData.PerManagerSummary || []).map(r => r.manager).filter(Boolean)
    )
  ).sort()

  // Compute Processed Record Book Data
  const getProcessedTableData = () => {
    let rows = []
    if (excelSheet === 'Top10_Seasons') {
      const key = top10Mode === 'incl' ? 'Top10_Seasons_InclPlayoffs' : 'Top10_Seasons_Reg'
      rows = [...(excelData[key] || [])]
    } else if (excelSheet === 'H2H_AllTime') {
      const key = h2hMode === 'incl' ? 'H2H_AllTime_PlayoffIncluded' : 'H2H_AllTime'
      rows = [...(excelData[key] || [])]
    } else if (excelSheet === 'H2H_Last5') {
      const key = h2hMode === 'incl' ? 'H2H_Last5_PlayoffIncluded' : 'H2H_Last5'
      rows = [...(excelData[key] || [])]
    } else {
      if (!excelData[excelSheet]) return []
      rows = [...excelData[excelSheet]]
    }

    // 1. Season Filter
    if (selectedSeasonFilter !== 'ALL') {
      rows = rows.filter(r => String(r.season) === String(selectedSeasonFilter))
    }

    // 2. Game Type Filter
    if (selectedGameTypeFilter !== 'ALL') {
      rows = rows.filter(r => String(r.game_type).toLowerCase() === String(selectedGameTypeFilter).toLowerCase())
    }

    // 3. Manager Filter (Strict primary manager matching to prevent duplicate reciprocal H2H rows)
    if (selectedManagerFilter !== 'ALL') {
      const targetM = selectedManagerFilter.toLowerCase()
      rows = rows.filter(r => {
        if ('manager' in r && r.manager) {
          return String(r.manager).toLowerCase() === targetM
        }
        const away = String(r.awayTeamName || '').toLowerCase()
        const home = String(r.homeTeamName || '').toLowerCase()
        const w = String(r.winner || '').toLowerCase()
        return away === targetM || home === targetM || w === targetM
      })
    }

    // 4. Global Search Filter
    if (searchTerm) {
      rows = rows.filter(row => 
        Object.values(row).some(val => 
          String(val || '').toLowerCase().includes(searchTerm.toLowerCase())
        )
      )
    }

    // 5. Column Sorting
    if (sortColumn) {
      rows.sort((a, b) => {
        let valA = a[sortColumn]
        let valB = b[sortColumn]

        if (valA === null || valA === undefined) return 1
        if (valB === null || valB === undefined) return -1

        if (typeof valA === 'number' && typeof valB === 'number') {
          return sortDirection === 'asc' ? valA - valB : valB - valA
        }

        const strA = String(valA).toLowerCase()
        const strB = String(valB).toLowerCase()
        if (strA < strB) return sortDirection === 'asc' ? -1 : 1
        if (strA > strB) return sortDirection === 'asc' ? 1 : -1
        return 0
      })
    }

    return rows
  }

  const processedTableData = getProcessedTableData()
  
  const rawMatchupItems = (liveData && liveData.matchups && (liveData.matchups[selectedWeek] || liveData.matchups[String(selectedWeek)])) || 
                          (liveData && liveData.matchups_by_week && (liveData.matchups_by_week[selectedWeek] || liveData.matchups_by_week[String(selectedWeek)])) || []

  const currentMatchups = (() => {
    if (!rawMatchupItems || rawMatchupItems.length === 0) return []
    if (Array.isArray(rawMatchupItems[0])) {
      return rawMatchupItems.map(pair => {
        return pair.map(item => {
          const cName = item.team_info?.canonical_name || item.canonical_name || item.display_name || `Team ${item.roster_id}`
          const tName = item.team_info?.team_name || item.team_name || (liveData && liveData.roster_team_map && liveData.roster_team_map[String(item.roster_id)]) || cName
          return {
            ...item,
            points: Number(item.points || 0),
            team_info: {
              canonical_name: cName,
              team_name: tName
            }
          }
        })
      })
    }

    const grouped = {}
    rawMatchupItems.forEach(item => {
      const mid = item.matchup_id
      if (mid !== undefined && mid !== null) {
        if (!grouped[mid]) grouped[mid] = []
        const cName = item.canonical_name || item.display_name || `Team ${item.roster_id}`
        const tName = item.team_name || (liveData && liveData.roster_team_map && liveData.roster_team_map[String(item.roster_id)]) || cName
        const formattedItem = {
          ...item,
          points: Number(item.points || 0),
          team_info: {
            canonical_name: cName,
            team_name: tName
          }
        }
        grouped[mid].push(formattedItem)
      }
    })

    return Object.values(grouped).filter(pair => pair.length === 2)
  })()

  const playoffRosterIds = new Set(
    (liveData.playoff_picture || []).map(entry => String(entry?.team?.roster_id))
  )

  return (
    <div className="app-container">
      {/* Header & Nav */}
      <header className="header-bar">
        <div className="brand-title">
          <img 
            src="/league_logo.jpg" 
            alt="Blaj League Logo" 
            style={{
              width: '60px',
              height: '60px',
              borderRadius: '0.375rem',
              objectFit: 'cover',
              border: '1px solid var(--border-color)',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)'
            }}
          />
          BLAJ
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            onClick={copyStateOfLeagueSummary}
            style={{
              padding: '0.5rem 0.85rem',
              borderRadius: '0.375rem',
              border: '1px solid var(--border-color)',
              backgroundColor: copiedToast === 'league' ? 'var(--accent-green)' : 'var(--bg-card)',
              color: copiedToast === 'league' ? '#000' : 'var(--text-primary)',
              fontWeight: '700',
              fontSize: '0.8rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              transition: 'all 0.15s ease',
              boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
            }}
            title="Copy League Standings, Playoff Picture, Punishment Watch & Odds to Clipboard"
          >
            {copiedToast === 'league' ? <Check size={15} /> : <Share2 size={15} color="#fde68a" />}
            {copiedToast === 'league' ? 'Copied League Summary!' : 'Copy League Summary'}
          </button>

          <button
            onClick={copyUpcomingWeekOutlook}
            style={{
              padding: '0.5rem 0.85rem',
              borderRadius: '0.375rem',
              border: '1px solid var(--border-color)',
              backgroundColor: copiedToast === 'upcoming' ? 'var(--accent-green)' : 'var(--bg-card)',
              color: copiedToast === 'upcoming' ? '#000' : 'var(--text-primary)',
              fontWeight: '700',
              fontSize: '0.8rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              transition: 'all 0.15s ease',
              boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
            }}
            title="Copy Upcoming Week Matchups & Historical H2H Matchup Facts to Clipboard"
          >
            {copiedToast === 'upcoming' ? <Check size={15} /> : <Flame size={15} color="var(--accent-amber)" />}
            {copiedToast === 'upcoming' ? 'Copied Week Preview!' : 'Copy Week Preview'}
          </button>

          <button
            onClick={downloadPdfReport}
            style={{
              padding: '0.5rem 0.85rem',
              borderRadius: '0.375rem',
              border: '1px solid rgba(245, 158, 11, 0.4)',
              backgroundColor: copiedToast === 'pdf' ? 'var(--accent-green)' : 'rgba(245, 158, 11, 0.12)',
              color: copiedToast === 'pdf' ? '#000' : '#fde68a',
              fontWeight: '800',
              fontSize: '0.8rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              transition: 'all 0.15s ease',
              boxShadow: '0 2px 6px rgba(245, 158, 11, 0.2)'
            }}
            title="Download the one-page portrait Blaj Weekly newspaper PDF"
          >
            {copiedToast === 'pdf' ? <Check size={15} /> : <FileDown size={15} color="#fde68a" />}
            {copiedToast === 'pdf' ? 'Newsletter Downloaded!' : 'Download Weekly (PDF)'}
          </button>

          <nav className="nav-tabs">
            <button 
              className={`nav-tab ${activeTab === 'home' ? 'active' : ''}`}
              onClick={() => setActiveTab('home')}
            >
              <Flame size={16} /> Home
            </button>
            <button 
              className={`nav-tab ${activeTab === 'recordbook' ? 'active' : ''}`}
              onClick={() => setActiveTab('recordbook')}
            >
              <BookOpen size={16} /> Record Book
            </button>
            <button 
              className={`nav-tab ${activeTab === 'halloffame' ? 'active' : ''}`}
              onClick={() => setActiveTab('halloffame')}
            >
              <Award size={16} /> Hall of Champions
            </button>
            <button 
              className={`nav-tab ${activeTab === 'simulator' ? 'active' : ''}`}
              onClick={() => setActiveTab('simulator')}
            >
              <Cpu size={16} /> Playoff Simulator
            </button>
            <button
              className={`nav-tab ${activeTab === 'explorer' ? 'active' : ''}`}
              onClick={() => setActiveTab('explorer')}
            >
              <TrendingUp size={16} /> Simulation Explorer
            </button>
          </nav>
        </div>
      </header>

      {/* TAB 1: HOME DASHBOARD */}
      {activeTab === 'home' && (
        <main>
          <FunFactGenerator excelData={excelData} setActiveManagerProfile={setActiveManagerProfile} />
          <div className="dashboard-grid">
          {/* LEFT COLUMN: STANDINGS, PUNISHMENT WATCH, & CALENDAR SHOOT */}
          <aside>
            <div className="card">
              <div className="card-title" style={{ justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Trophy size={18} color="var(--accent-green)" /> League Standings
                </div>
                <div style={{ display: 'flex', gap: '0.25rem' }}>
                  <button
                    onClick={() => setStandingsView('actual')}
                    style={{
                      padding: '0.2rem 0.5rem',
                      borderRadius: '0.25rem',
                      border: '1px solid var(--border-color)',
                      backgroundColor: standingsView === 'actual' ? 'var(--accent-green)' : 'var(--bg-primary)',
                      color: standingsView === 'actual' ? '#000' : 'var(--text-muted)',
                      fontWeight: '700',
                      cursor: 'pointer',
                      fontSize: '0.7rem'
                    }}
                  >
                    Actual
                  </button>
                  <button
                    onClick={() => setStandingsView('luck')}
                    style={{
                      padding: '0.2rem 0.5rem',
                      borderRadius: '0.25rem',
                      border: '1px solid var(--border-color)',
                      backgroundColor: standingsView === 'luck' ? 'var(--accent-amber)' : 'var(--bg-primary)',
                      color: standingsView === 'luck' ? '#fff' : 'var(--text-muted)',
                      fontWeight: '700',
                      cursor: 'pointer',
                      fontSize: '0.7rem'
                    }}
                  >
                    Luck Index
                  </button>
                </div>
              </div>

              {standingsView === 'actual' ? (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Manager</th>
                      <th className="wl-col">W-L</th>
                      <th className="pf-col">PF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(liveData.standings || []).map((team) => (
                      <tr key={team.roster_id}>
                        <td style={{ fontWeight: '700', color: playoffRosterIds.has(String(team.roster_id)) ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                          {team.rank}
                        </td>
                        <td className="team-name-cell">
                          <div 
                            style={{ fontWeight: '700', color: '#fde68a', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.875rem', wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                            onClick={() => setActiveManagerProfile(team.canonical_name)}
                            title={`Click to view ${team.canonical_name}'s profile`}
                          >
                            {team.team_name || team.canonical_name}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600' }}>{team.canonical_name}</div>
                        </td>
                        <td className="wl-col" style={{ fontWeight: '600' }}>{team.wins}-{team.losses}</td>
                        <td className="pf-col" style={{ fontWeight: '600' }}>{team.points_for.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Team</th>
                      <th className="wl-col">W-L</th>
                      <th>Exp W-L</th>
                      <th>Luck</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const luckCalculated = calculateLuckRows(liveData.standings || [], {
                        matchupsByWeek: liveData.matchups_by_week,
                        matchLog: excelData?.MatchLog_PlayoffIncluded || [],
                        season: liveData.season,
                        throughWeek: Math.max(0, Number(liveData.current_week || 1) - 1)
                      }).map(team => ({
                        ...team,
                        expWins: team.expectedWins,
                        luckDiff: team.luck,
                        totalGames: team.expectedGames
                      }));

                      // Sort Luck table by Expected Wins descending (best scoring teams at the top)
                      luckCalculated.sort((a, b) => b.expWins - a.expWins || b.points_for - a.points_for);

                      return luckCalculated.map((team) => (
                        <tr key={team.roster_id}>
                          <td className="team-name-cell">
                            <div 
                              style={{ fontWeight: '700', color: '#fde68a', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.875rem', wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                              onClick={() => setActiveManagerProfile(team.canonical_name)}
                              title={`Click to view ${team.canonical_name}'s profile`}
                            >
                              {team.team_name || team.canonical_name}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600' }}>{team.canonical_name}</div>
                          </td>
                          <td className="wl-col" style={{ fontWeight: '600' }}>{team.wins}-{team.losses}</td>
                          <td style={{ fontWeight: '600' }}>{team.expWins.toFixed(1)} - {team.expectedLosses.toFixed(1)}</td>
                          <td>
                            <span style={{
                              fontWeight: '800',
                              color: team.luckDiff > 0.1 ? 'var(--accent-green)' : (team.luckDiff < -0.1 ? 'var(--danger-red)' : 'var(--text-muted)')
                            }}>
                              {team.luckDiff > 0 ? `▲ +${team.luckDiff.toFixed(1)}` : (team.luckDiff < 0 ? `▼ ${team.luckDiff.toFixed(1)}` : '0.0')}
                            </span>
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              )}
            </div>

            {/* PUNISHMENT WATCH */}
            <div className="punishment-card">
              <div className="punishment-title">
                <ShieldAlert size={20} /> PUNISHMENT WATCH
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                Bottom 3 seeds currently in danger of the punishment:
              </p>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Seed</th>
                    <th>Team</th>
                    <th className="wl-col">W-L</th>
                    <th className="pf-col">PF</th>
                  </tr>
                </thead>
                <tbody>
                  {(liveData.punishment_watch || []).map((team) => (
                    <tr key={team.roster_id}>
                      <td style={{ fontWeight: '700', color: 'var(--danger-red)' }}>#{team.rank}</td>
                      <td className="team-name-cell">
                        <div 
                          style={{ fontWeight: '700', color: '#fde68a', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.875rem', wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                          onClick={() => setActiveManagerProfile(team.canonical_name)}
                          title={`Click to view ${team.canonical_name}'s profile`}
                        >
                          {team.team_name || team.canonical_name}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600' }}>{team.canonical_name}</div>
                      </td>
                      <td className="wl-col" style={{ color: 'var(--danger-red)', fontWeight: '700' }}>{team.wins}-{team.losses}</td>
                      <td className="pf-col" style={{ fontWeight: '600' }}>{team.points_for.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </aside>

          {/* CENTER COLUMN: MATCHUPS HUB */}
          <section className="matchups-container">
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div className="card-title" style={{ margin: 0 }}>
                  <Flame size={18} color="var(--accent-green)" /> Matchups Hub
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Week:</span>
                  <select 
                    value={selectedWeek} 
                    onChange={(e) => setSelectedWeek(Number(e.target.value))}
                    style={{
                      backgroundColor: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-color)',
                      padding: '0.25rem 0.5rem',
                      borderRadius: '0.375rem'
                    }}
                  >
                    {Array.from({ length: 14 }, (_, i) => i + 1).map(w => (
                      <option key={w} value={w}>Week {w}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* LIST MATCHUPS FOR SELECTED WEEK */}
              {currentMatchups.length > 0 ? (
                currentMatchups.map((matchup, idx) => {
                  if (matchup.length < 2) return null
                  const teamA = matchup[0]
                  const teamB = matchup[1]
                  const h2h = getH2HRecord(teamA.team_info.canonical_name, teamB.team_info.canonical_name)
                  const weekProjectionLookup = weeklyProjections[String(selectedWeek)]
                  const projectionOptions = {
                    playerTeams: weeklyProjectionTeams[String(selectedWeek)],
                    gameStatuses: weeklyGameStatuses[String(selectedWeek)]
                  }
                  const teamAProjection = projectedLineupTotal(teamA.starters, weekProjectionLookup, {
                    ...projectionOptions,
                    actualPoints: teamA.players_points
                  })
                  const teamBProjection = projectedLineupTotal(teamB.starters, weekProjectionLookup, {
                    ...projectionOptions,
                    actualPoints: teamB.players_points
                  })

                  return (
                    <div key={idx} className="matchup-card" style={{ marginBottom: '1rem' }}>
                      <div className="matchup-header">
                        <span>Matchup {idx + 1}</span>
                        <span style={{ color: 'var(--accent-amber)', fontWeight: '700', fontSize: '0.8125rem', backgroundColor: 'rgba(217, 119, 6, 0.12)', padding: '0.2rem 0.65rem', borderRadius: '0.25rem', border: '1px solid rgba(217, 119, 6, 0.3)', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                          ⚔️ Lifetime Series: <strong>{h2h}</strong>
                        </span>
                      </div>
                      <div className="matchup-teams">
                        <div className="team-box">
                          <div className="team-avatar team-avatar-initials" aria-hidden="true">
                            {teamA.team_info.canonical_name?.charAt(0) || '?'}
                          </div>
                          <div className="team-name" style={{ fontWeight: '800', color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                            {teamA.team_info.team_name}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--accent-amber)', fontWeight: '600' }}>
                            {teamA.team_info.canonical_name}
                          </div>
                          <div className="team-score-row">
                            <span className="team-score">{teamA.points.toFixed(2)}</span>
                            {teamAProjection !== null && (
                              <span className="team-projection">Proj {teamAProjection.toFixed(2)}</span>
                            )}
                          </div>
                        </div>
                        <div className="vs-badge">VS</div>
                        <div className="team-box">
                          <div className="team-avatar team-avatar-initials" aria-hidden="true">
                            {teamB.team_info.canonical_name?.charAt(0) || '?'}
                          </div>
                          <div className="team-name" style={{ fontWeight: '800', color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                            {teamB.team_info.team_name}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--accent-amber)', fontWeight: '600' }}>
                            {teamB.team_info.canonical_name}
                          </div>
                          <div className="team-score-row">
                            <span className="team-score">{teamB.points.toFixed(2)}</span>
                            {teamBProjection !== null && (
                              <span className="team-projection">Proj {teamBProjection.toFixed(2)}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <p style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '0.5rem', fontSize: '1rem' }}>
                    No live matchups generated for Week {selectedWeek} yet.
                  </p>
                  <p style={{ fontSize: '0.8125rem' }}>
                    The 2026 NFL season matchups will automatically populate here once games kick off!
                  </p>
                </div>
              )}
            </div>

            {/* WEEK-OVER-WEEK ODDS MOVERS CARD */}
            {liveData.odds_movers && (
              <div className="card" style={{ marginTop: '1.25rem' }}>
                <div className="card-title" style={{ justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <TrendingUp size={20} color="var(--accent-green)" /> Week-over-Week Movers (Odds)
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {liveData.odds_movers.from_week} ➔ {liveData.odds_movers.to_week}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1rem' }}>
                  {/* BIGGEST RISERS */}
                  <div style={{ backgroundColor: 'var(--bg-primary)', padding: '1rem', borderRadius: '0.5rem', border: '1px solid rgba(34, 197, 94, 0.2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--accent-green)', fontWeight: '700', fontSize: '0.8125rem', marginBottom: '0.75rem' }}>
                      <TrendingUp size={16} /> Biggest Risers (Playoff %)
                    </div>
                    {(liveData.odds_movers.risers || []).map((m, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 0', borderBottom: idx < liveData.odds_movers.risers.length - 1 ? '1px solid var(--border-color)' : 'none', fontSize: '0.8125rem' }}>
                        <div>
                          <div style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{m.manager}</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>from {m.prev_pct.toFixed(2)}%</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: '800', color: 'var(--accent-green)' }}>{m.curr_pct.toFixed(2)}%</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--accent-green)', fontWeight: '700' }}>▲ +{m.change.toFixed(2)}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* BIGGEST FALLERS */}
                  <div style={{ backgroundColor: 'var(--bg-primary)', padding: '1rem', borderRadius: '0.5rem', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--danger-red)', fontWeight: '700', fontSize: '0.8125rem', marginBottom: '0.75rem' }}>
                      <TrendingDown size={16} /> Biggest Fallers
                    </div>
                    {(liveData.odds_movers.fallers || []).map((m, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 0', borderBottom: idx < liveData.odds_movers.fallers.length - 1 ? '1px solid var(--border-color)' : 'none', fontSize: '0.8125rem' }}>
                        <div>
                          <div style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{m.manager}</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>from {m.prev_pct.toFixed(2)}%</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: '800', color: 'var(--danger-red)' }}>{m.curr_pct.toFixed(2)}%</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--danger-red)', fontWeight: '700' }}>▼ {m.change.toFixed(2)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* TINY PROBABILITIES / LONGSHOTS CALLOUT */}
                {liveData.odds_movers.tiny_probabilities && (
                  <div style={{ backgroundColor: 'rgba(168, 85, 247, 0.1)', border: '1px solid rgba(168, 85, 247, 0.3)', borderRadius: '0.5rem', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <Zap size={18} color="var(--accent-amber)" style={{ flexShrink: 0 }} />
                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
                      <strong style={{ color: 'var(--accent-amber)' }}>Tiny Probabilities: </strong> 
                      {liveData.odds_movers.tiny_probabilities}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* RIGHT COLUMN: PUNISHMENT CALENDAR & PLAYOFF PICTURE */}
          <aside style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* ARYAN'S CALENDAR SHOOT SIDEBAR (FIRST) */}
            <div className="calendar-sidebar-card card">
              <div className="card-title" style={{ color: 'var(--danger-red)', marginBottom: '0.5rem' }}>
                <Camera size={18} color="var(--danger-red)" /> Aryan's Calendar Shoot
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                Click any month thumbnail to view full photo:
              </p>
              
              <div className="calendar-grid-preview">
                {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                  <div 
                    key={month} 
                    className="calendar-thumb"
                    onClick={() => setActivePhotoMonth(month)}
                  >
                    <img 
                      src={`/calendar/month_${month}.jpg`} 
                      alt={`Month ${month}`}
                    />
                    <div style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      backgroundColor: 'rgba(0,0,0,0.75)',
                      color: '#fff',
                      fontSize: '0.65rem',
                      fontWeight: '800',
                      textAlign: 'center',
                      padding: '2px 0'
                    }}>
                      {MONTH_NAMES_MAP[month]?.short || month}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* PLAYOFF PICTURE CARD (SECOND) */}
            <div className="card">
              <div className="card-title">
                <Trophy size={18} color="var(--accent-blue)" /> Playoff Picture
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                Top 6 make playoffs (Seeds 1-3: Div Leaders, Seed 4: Wildcard, Seeds 5-6: Highest PF)
              </p>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Seed</th>
                    <th>Team</th>
                    <th>Qualifier</th>
                  </tr>
                </thead>
                <tbody>
                  {(liveData.playoff_picture || []).map((p) => (
                    <tr key={p.seed}>
                      <td style={{ fontWeight: '800', color: 'var(--accent-blue)' }}>#{p.seed}</td>
                      <td className="team-name-cell">
                        <div 
                          style={{ fontWeight: '700', color: '#fde68a', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.875rem', wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                          onClick={() => setActiveManagerProfile(p.team.canonical_name)}
                          title={`Click to view ${p.team.canonical_name}'s profile`}
                        >
                          {p.team.team_name || p.team.canonical_name}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600' }}>
                          {p.team.canonical_name} • {p.team.wins}-{p.team.losses} ({p.team.points_for.toFixed(2)} PF)
                        </div>
                      </td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--accent-green)', fontWeight: '600' }}>{p.type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </aside>
        </div>
      </main>
      )}

      {/* TAB 2: RECORD BOOK */}
      {activeTab === 'recordbook' && (
        <main>
          <div className="card">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
              <div className="card-title" style={{ margin: 0 }}>
                <BookOpen size={20} color="var(--accent-amber)" /> League Record Book
              </div>

              <div className="sheet-selector-container">
                {sheetKeys.map(key => (
                  <button
                    key={key}
                    onClick={() => {
                      setExcelSheet(key)
                      setSortColumn(null)
                      setSelectedSeasonFilter('ALL')
                      setSelectedGameTypeFilter('ALL')
                      setSelectedManagerFilter('ALL')
                    }}
                    style={{
                      padding: '0.45rem 0.85rem',
                      borderRadius: '0.375rem',
                      border: '1px solid var(--border-color)',
                      backgroundColor: excelSheet === key ? 'var(--accent-amber)' : 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: '0.8125rem',
                      fontWeight: '600'
                    }}
                  >
                    {SHEET_LABEL_MAP[key] || key}
                  </button>
                ))}
              </div>
            </div>

            {/* TOP 10 SEASONS SUB-TOGGLE */}
            {excelSheet === 'Top10_Seasons' && (
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontWeight: '600' }}>Filter Scope:</span>
                <button
                  onClick={() => setTop10Mode('incl')}
                  style={{
                    padding: '0.3rem 0.75rem',
                    borderRadius: '0.375rem',
                    border: '1px solid var(--border-color)',
                    backgroundColor: top10Mode === 'incl' ? 'var(--accent-green)' : 'var(--bg-primary)',
                    color: top10Mode === 'incl' ? '#000' : 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    fontWeight: '700'
                  }}
                >
                  Incl. Playoffs
                </button>
                <button
                  onClick={() => setTop10Mode('reg')}
                  style={{
                    padding: '0.3rem 0.75rem',
                    borderRadius: '0.375rem',
                    border: '1px solid var(--border-color)',
                    backgroundColor: top10Mode === 'reg' ? 'var(--accent-green)' : 'var(--bg-primary)',
                    color: top10Mode === 'reg' ? '#000' : 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    fontWeight: '700'
                  }}
                >
                  Regular Season Only
                </button>
              </div>
            )}

            {/* H2H SUB-TOGGLE */}
            {(excelSheet === 'H2H_AllTime' || excelSheet === 'H2H_Last5') && (
              <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontWeight: '600' }}>Game Scope:</span>
                  <button
                    onClick={() => setH2hMode('reg')}
                    style={{
                      padding: '0.3rem 0.75rem',
                      borderRadius: '0.375rem',
                      border: '1px solid var(--border-color)',
                      backgroundColor: h2hMode === 'reg' ? 'var(--accent-amber)' : 'var(--bg-primary)',
                      color: h2hMode === 'reg' ? '#fff' : 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: '700'
                    }}
                  >
                    Regular Season Only
                  </button>
                  <button
                    onClick={() => setH2hMode('incl')}
                    style={{
                      padding: '0.3rem 0.75rem',
                      borderRadius: '0.375rem',
                      border: '1px solid var(--border-color)',
                      backgroundColor: h2hMode === 'incl' ? 'var(--accent-amber)' : 'var(--bg-primary)',
                      color: h2hMode === 'incl' ? '#fff' : 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: '700'
                    }}
                  >
                    Incl. Playoffs
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontWeight: '600' }}>Format:</span>
                  <button
                    onClick={() => setH2hDisplayMode('matrix')}
                    style={{
                      padding: '0.3rem 0.75rem',
                      borderRadius: '0.375rem',
                      border: '1px solid var(--border-color)',
                      backgroundColor: h2hDisplayMode === 'matrix' ? 'var(--accent-green)' : 'var(--bg-primary)',
                      color: h2hDisplayMode === 'matrix' ? '#000' : 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: '700'
                    }}
                  >
                    Matrix Grid
                  </button>
                  <button
                    onClick={() => setH2hDisplayMode('list')}
                    style={{
                      padding: '0.3rem 0.75rem',
                      borderRadius: '0.375rem',
                      border: '1px solid var(--border-color)',
                      backgroundColor: h2hDisplayMode === 'list' ? 'var(--accent-green)' : 'var(--bg-primary)',
                      color: h2hDisplayMode === 'list' ? '#000' : 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: '700'
                    }}
                  >
                    List Table
                  </button>
                </div>
              </div>
            )}



            {/* FILTERS & SEARCH ROW */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <div style={{ flex: '1 1 200px', display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: 'var(--bg-primary)', padding: '0.5rem 0.75rem', borderRadius: '0.375rem', border: '1px solid var(--border-color)' }}>
                <Search size={16} color="var(--text-muted)" />
                <input 
                  type="text" 
                  placeholder={`Search ${SHEET_LABEL_MAP[excelSheet] || excelSheet}...`}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{
                    backgroundColor: 'transparent',
                    border: 'none',
                    color: 'var(--text-primary)',
                    width: '100%',
                    outline: 'none',
                    fontSize: '0.875rem'
                  }}
                />
              </div>

              {availableSeasons.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: 'var(--bg-primary)', padding: '0.5rem 0.75rem', borderRadius: '0.375rem', border: '1px solid var(--border-color)' }}>
                  <Filter size={14} color="var(--text-muted)" />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600' }}>Season:</span>
                  <select
                    value={selectedSeasonFilter}
                    onChange={e => setSelectedSeasonFilter(e.target.value)}
                    style={{ backgroundColor: 'transparent', color: 'var(--text-primary)', border: 'none', outline: 'none', cursor: 'pointer', fontSize: '0.875rem' }}
                  >
                    <option value="ALL" style={{ backgroundColor: 'var(--bg-card)' }}>All Seasons</option>
                    {availableSeasons.map(s => (
                      <option key={s} value={s} style={{ backgroundColor: 'var(--bg-card)' }}>{s}</option>
                    ))}
                  </select>
                </div>
              )}

              {availableGameTypes.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: 'var(--bg-primary)', padding: '0.5rem 0.75rem', borderRadius: '0.375rem', border: '1px solid var(--border-color)' }}>
                  <Filter size={14} color="var(--text-muted)" />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600' }}>Type:</span>
                  <select
                    value={selectedGameTypeFilter}
                    onChange={e => setSelectedGameTypeFilter(e.target.value)}
                    style={{ backgroundColor: 'transparent', color: 'var(--text-primary)', border: 'none', outline: 'none', cursor: 'pointer', fontSize: '0.875rem' }}
                  >
                    <option value="ALL" style={{ backgroundColor: 'var(--bg-card)' }}>All Games</option>
                    {availableGameTypes.map(gt => (
                      <option key={gt} value={gt} style={{ backgroundColor: 'var(--bg-card)' }}>{gt.toUpperCase()}</option>
                    ))}
                  </select>
                </div>
              )}

              {availableManagers.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: 'var(--bg-primary)', padding: '0.5rem 0.75rem', borderRadius: '0.375rem', border: '1px solid var(--border-color)' }}>
                  <Filter size={14} color="var(--text-muted)" />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600' }}>Manager:</span>
                  <select
                    value={selectedManagerFilter}
                    onChange={e => setSelectedManagerFilter(e.target.value)}
                    style={{ backgroundColor: 'transparent', color: 'var(--text-primary)', border: 'none', outline: 'none', cursor: 'pointer', fontSize: '0.875rem' }}
                  >
                    <option value="ALL" style={{ backgroundColor: 'var(--bg-card)' }}>All Managers</option>
                    {availableManagers.map(m => (
                      <option key={m} value={m} style={{ backgroundColor: 'var(--bg-card)' }}>{m}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* MATRIX GRID VIEW FOR H2H TABS */}
            {(excelSheet === 'H2H_AllTime' || excelSheet === 'H2H_Last5') && h2hDisplayMode === 'matrix' ? (
              <div className="table-container" style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ fontSize: '0.75rem', textAlign: 'center' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', minWidth: '110px' }}>Manager</th>
                      {availableManagers.map(m => (
                        <th key={m} style={{ textAlign: 'center', minWidth: '70px', padding: '0.5rem 0.25rem' }}>
                          {m.split('/')[0]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {availableManagers.map(m1 => (
                      <tr key={m1}>
                        <td style={{ fontWeight: '700', color: 'var(--text-primary)', textAlign: 'left', backgroundColor: 'var(--bg-card)' }}>
                          {m1}
                        </td>
                        {availableManagers.map(m2 => {
                          if (m1 === m2) {
                            return <td key={m2} style={{ backgroundColor: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)' }}>—</td>
                          }
                          const row = processedTableData.find(r => r.manager === m1 && r.opponent === m2)
                          if (!row) {
                            return <td key={m2} style={{ color: 'var(--text-muted)' }}>-</td>
                          }
                          const w = row.W !== undefined ? row.W : (row.last5_W !== undefined ? row.last5_W : 0)
                          const l = row.L !== undefined ? row.L : (row.last5_L !== undefined ? row.last5_L : 0)
                          const t = row.T !== undefined ? row.T : (row.last5_T !== undefined ? row.last5_T : 0)
                          const recStr = `${w}-${l}${t > 0 ? `-${t}` : ''}`
                          const isWin = w > l
                          const isLoss = l > w

                          return (
                            <td 
                              key={m2}
                              title={`${m1} vs ${m2}: ${recStr}`}
                              style={{
                                backgroundColor: isWin ? 'rgba(34, 197, 94, 0.12)' : (isLoss ? 'rgba(239, 68, 68, 0.12)' : 'transparent'),
                                color: isWin ? 'var(--accent-green)' : (isLoss ? 'var(--danger-red)' : 'var(--text-muted)'),
                                fontWeight: '700',
                                padding: '0.5rem 0.25rem'
                              }}
                            >
                              {recStr}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : processedTableData.length > 0 ? (
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      {Object.keys(processedTableData[0])
                        .filter(col => col !== 'is_championship' && col !== 'round')
                        .map(col => (
                          <th 
                            key={col} 
                            className="sortable"
                            onClick={() => handleSort(col)}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              <span>{COLUMN_HEADER_MAP[col] || col}</span>
                              {sortColumn === col ? (
                                sortDirection === 'asc' ? <ArrowUp size={12} color="var(--accent-green)" /> : <ArrowDown size={12} color="var(--accent-green)" />
                              ) : (
                                <ArrowUpDown size={12} color="var(--text-muted)" />
                              )}
                            </div>
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {processedTableData.map((row, idx) => (
                      <tr key={idx}>
                        {Object.entries(row)
                          .filter(([col]) => col !== 'is_championship' && col !== 'round')
                          .map(([col, val], cIdx) => (
                            <td key={cIdx}>{formatCellValue(val, col)}</td>
                          ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', padding: '1rem' }}>No data matches your filter criteria.</p>
            )}
          </div>
        </main>
      )}

      {/* TAB 3: HALL OF CHAMPIONS */}
      {activeTab === 'halloffame' && (
        <main>
          <div className="card">
            <div className="card-title">
              <Award size={20} color="var(--accent-green)" /> Hall of Champions (2017 – Present)
            </div>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
              Every championship team and manager in Blaj Fantasy Football history.
            </p>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
              {(liveData.champions_history || []).map((c, idx) => (
                <div key={idx} className="card" style={{ backgroundColor: 'var(--bg-primary)', textAlign: 'center', border: '1px solid var(--accent-green)', padding: '1.5rem' }}>
                  <div style={{ fontSize: '0.875rem', fontWeight: '800', color: 'var(--accent-green)', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                    {c.season} CHAMPION
                  </div>
                  <Trophy size={48} color="var(--accent-green)" style={{ margin: '0.5rem auto 1rem auto' }} />
                  <h3 style={{ color: 'var(--text-primary)', fontSize: '1.4rem', fontWeight: '800' }}>{c.canonical_name}</h3>
                  <div style={{ fontSize: '0.95rem', color: 'var(--accent-green)', fontWeight: '700', marginTop: '0.5rem' }}>
                    "{c.team_name}"
                  </div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                    Owner: {c.champion}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      )}

      {/* TAB 4: PLAYOFF SIMULATOR */}
      {activeTab === 'simulator' && (
        <main style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '1.5rem' }}>
          {/* LEFT PANEL: SIMULATOR CONTROLS */}
          <aside className="card">
            <div className="card-title" style={{ marginBottom: '1rem' }}>
              <Sliders size={20} color="var(--accent-green)" /> Simulation Controls
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ fontSize: '0.8125rem', fontWeight: '700', color: 'var(--text-primary)', display: 'block', marginBottom: '0.5rem' }}>
                  Simulation Model
                </label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => setSimModel('Bayesian')}
                    style={{
                      flex: 1,
                      padding: '0.45rem',
                      borderRadius: '0.375rem',
                      border: '1px solid var(--border-color)',
                      backgroundColor: simModel === 'Bayesian' ? 'var(--accent-green)' : 'var(--bg-primary)',
                      color: simModel === 'Bayesian' ? '#000' : 'var(--text-primary)',
                      fontWeight: '700',
                      cursor: 'pointer',
                      fontSize: '0.8125rem'
                    }}
                  >
                    Bayesian
                  </button>
                  <button
                    onClick={() => setSimModel('Simple')}
                    style={{
                      flex: 1,
                      padding: '0.45rem',
                      borderRadius: '0.375rem',
                      border: '1px solid var(--border-color)',
                      backgroundColor: simModel === 'Simple' ? 'var(--accent-green)' : 'var(--bg-primary)',
                      color: simModel === 'Simple' ? '#000' : 'var(--text-primary)',
                      fontWeight: '700',
                      cursor: 'pointer',
                      fontSize: '0.8125rem'
                    }}
                  >
                    Simple
                  </button>
                </div>
              </div>

              {simModel === 'Bayesian' && (
                <>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                      <span style={{ fontSize: '0.8125rem', fontWeight: '600' }}>Prior STD</span>
                      <span style={{ fontSize: '0.8125rem', color: 'var(--accent-green)', fontWeight: '700' }}>{simPriorStd}</span>
                    </div>
                    <input 
                      type="range" min="2" max="60" value={simPriorStd} 
                      onChange={(e) => setSimPriorStd(Number(e.target.value))}
                      style={{ width: '100%' }}
                    />
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      Lower = lean to league avg. Higher = lean to team avg.
                    </span>
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                      <span style={{ fontSize: '0.8125rem', fontWeight: '600' }}>Strength Evidence Sigma</span>
                      <span style={{ fontSize: '0.8125rem', color: 'var(--accent-green)', fontWeight: '700' }}>{simMinSigma}</span>
                    </div>
                    <input 
                      type="range" min="10" max="70" value={simMinSigma}
                      onChange={(e) => setSimMinSigma(Number(e.target.value))}
                      style={{ width: '100%' }}
                    />
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      Higher values are more cautious about treating a short scoring sample as true team strength. Weekly score volatility is calibrated separately.
                    </span>
                  </div>
                </>
              )}

              <div>
                <label style={{ fontSize: '0.8125rem', fontWeight: '700', color: 'var(--text-primary)', display: 'block', marginBottom: '0.25rem' }}>
                  Number of Simulations
                </label>
                <input 
                  type="number" min="100" max="50000" step="500"
                  value={simCount}
                  onChange={(e) => setSimCount(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '0.375rem',
                    color: 'var(--text-primary)',
                    fontWeight: '700'
                  }}
                />
              </div>

              <button
                onClick={() => {
                  setIsSimulating(true);
                  setTimeout(() => {
                    // Extract baseline teams from live standings or historical proxies
                    const standings = liveData.standings || [];
                    const managerProxies = (excelData.PerManagerSummary || []);
                    const curWk = liveData.current_week || 1;
                    const completedScores = collectCompletedWeeklyScores(liveData.matchups_by_week, curWk);
                    const teams = standings.map(s => {
                      const proxy = managerProxies.find(m => m.manager === s.canonical_name);
                      return {
                        name: s.canonical_name,
                        wins: s.wins || 0,
                        losses: s.losses || 0,
                        fpts: s.points_for || 0,
                        division: s.division || 1,
                        weeklyScores: completedScores[s.canonical_name] || [],
                        historicalAvg: proxy ? Math.max(100.0, proxy.highest_score * 0.7) : 110.0
                      };
                    });

                    // Build remaining schedule from unplayed matchups for upcoming weeks (> current_week)
                    const remainingSchedule = [];
                    const matchupsByWk = liveData.matchups_by_week || {};

                    Object.keys(matchupsByWk).forEach(wkStr => {
                      const wkNum = Number(wkStr);
                      if (wkNum >= curWk) {
                        const pairs = matchupsByWk[wkStr] || [];
                        pairs.forEach(pair => {
                          if (pair.length >= 2) {
                            const away = pair[0].team_info?.canonical_name;
                            const home = pair[1].team_info?.canonical_name;
                            if (away && home) {
                              remainingSchedule.push([away, home]);
                            }
                          }
                        });
                      }
                    });

                    const res = runPlayoffSimulation({
                      teams,
                      remainingSchedule,
                      simulations: simCount,
                      model: simModel,
                      priorStd: simPriorStd,
                      minSigma: simMinSigma,
                      scoreModel: SIMULATION_MODEL.scoreModel,
                      weeklySigma: SIMULATION_MODEL.weeklySigma,
                      volatilityPriorGames: SIMULATION_MODEL.volatilityPriorGames,
                      overrides: simOverrides,
                      divisions: liveData.divisions || {}
                    });

                    setSimResults(res);
                    setIsSimulating(false);
                  }, 50);
                }}
                disabled={isSimulating}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  backgroundColor: 'var(--accent-green)',
                  color: '#000',
                  border: 'none',
                  borderRadius: '0.375rem',
                  fontWeight: '800',
                  fontSize: '0.9rem',
                  cursor: isSimulating ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem'
                }}
              >
                {isSimulating ? <RefreshCw size={18} className="spin" /> : <Play size={18} />}
                {isSimulating ? 'Simulating...' : 'Run Simulation'}
              </button>

              {Object.keys(simOverrides).length > 0 && (
                <button
                  onClick={() => setSimOverrides({})}
                  style={{
                    width: '100%',
                    padding: '0.45rem',
                    backgroundColor: 'transparent',
                    color: 'var(--danger-red)',
                    border: '1px solid var(--danger-border)',
                    borderRadius: '0.375rem',
                    fontWeight: '700',
                    fontSize: '0.75rem',
                    cursor: 'pointer'
                  }}
                >
                  Clear What-If Overrides ({Object.keys(simOverrides).length})
                </button>
              )}
            </div>
          </aside>

          {/* RIGHT PANEL: SIMULATION RESULTS TABLE */}
          <section className="card">
            <div className="card-title" style={{ justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Cpu size={20} color="var(--accent-blue)" /> Simulated Playoff & Punishment Odds
              </div>
              {simResults && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {simCount.toLocaleString()} Iterations ({simModel} Engine)
                </div>
              )}
            </div>

            {simResults ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Manager</th>
                    <th>Playoff Odds</th>
                    <th>1st Bye Odds</th>
                    <th>Div Winner Odds</th>
                    <th>Last Place Odds</th>
                    <th>Avg Proj W-L</th>
                    <th>Avg Proj PF</th>
                  </tr>
                </thead>
                <tbody>
                  {simResults.map((r, idx) => (
                    <tr key={idx}>
                      <td style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{r.name}</td>
                      <td>
                        <div>
                          <span style={{ 
                            fontWeight: '800',
                            color: r.playoffPct >= 70 ? 'var(--accent-green)' : (r.playoffPct >= 30 ? 'var(--accent-blue)' : 'var(--text-muted)')
                          }}>
                            {r.playoffPct.toFixed(1)}%
                          </span>
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: '600' }}>
                          ({(r.playoffCount || 0).toLocaleString()} / {simCount.toLocaleString()})
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: '600' }}>{r.byePct.toFixed(1)}%</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          ({(r.byeCount || 0).toLocaleString()})
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: '600' }}>{r.divWinnerPct.toFixed(1)}%</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          ({(r.divWinnerCount || 0).toLocaleString()})
                        </div>
                      </td>
                      <td>
                        <div>
                          <span style={{ 
                            fontWeight: '700',
                            color: r.lastPct >= 25 ? 'var(--danger-red)' : 'var(--text-muted)'
                          }}>
                            {r.lastPct.toFixed(1)}%
                          </span>
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          ({(r.lastCount || 0).toLocaleString()})
                        </div>
                      </td>
                      <td style={{ fontWeight: '600' }}>{r.projWins} - {(14 - r.projWins).toFixed(1)}</td>
                      <td style={{ fontWeight: '600' }}>{r.projFpts.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: '4rem 2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                <Cpu size={48} color="var(--border-color)" style={{ marginBottom: '1rem' }} />
                <h3 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Ready to Run Simulation</h3>
                <p style={{ fontSize: '0.875rem', maxWidth: '480px', margin: '0 auto' }}>
                  Click <strong>"Run Monte Carlo Simulation"</strong> on the left control panel to simulate remaining regular season games and compute live Playoff & Punishment probabilities!
                </p>
              </div>
            )}
          </section>
        </main>
      )}

      {/* TAB 5: CONDITIONAL SIMULATION EXPLORER */}
      {activeTab === 'explorer' && (
        <SimulationExplorer liveData={liveData} excelData={excelData} />
      )}

      {/* PER-MANAGER PROFILE MODAL */}
      {activeManagerProfile && (
        <div 
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1.5rem'
          }}
          onClick={() => setActiveManagerProfile(null)}
        >
          <div 
            className="card" 
            style={{ 
              width: '720px', 
              maxWidth: '95vw', 
              maxHeight: '90vh',
              overflowY: 'auto',
              position: 'relative', 
              padding: '1.75rem',
              backgroundColor: 'var(--bg-card)',
              border: '2px solid #fde68a',
              boxShadow: '0 20px 50px rgba(0,0,0,0.8)'
            }}
            onClick={e => e.stopPropagation()}
          >
            <button 
              onClick={() => setActiveManagerProfile(null)}
              style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={24} />
            </button>

            {(() => {
              const mName = activeManagerProfile;
              const summary = (excelData.PerManagerSummary || []).find(m => m.manager === mName) || {};
              const playoff = (excelData.PlayoffSummary || []).find(m => m.manager === mName) || {};
              const champs = (liveData.champions_history || []).filter(c => c.canonical_name === mName || c.champion === mName);
              
              // Calculate Nemesis and Favorite Matchup
              const matchLog = excelData.MatchLog_PlayoffIncluded || [];
              const opponentStats = {};

              matchLog.forEach(l => {
                let opp = null;
                let won = false;
                let lost = false;

                if (l.awayTeamName === mName) {
                  opp = l.homeTeamName;
                  won = (l.winner === mName);
                  lost = (l.loser === mName);
                } else if (l.homeTeamName === mName) {
                  opp = l.awayTeamName;
                  won = (l.winner === mName);
                  lost = (l.loser === mName);
                }

                if (opp && opp !== mName) {
                  if (!opponentStats[opp]) opponentStats[opp] = { wins: 0, losses: 0, total: 0 };
                  opponentStats[opp].total += 1;
                  if (won) opponentStats[opp].wins += 1;
                  if (lost) opponentStats[opp].losses += 1;
                }
              });

              let nemesis = null;
              let favoriteMatchup = null;
              let minWinPct = 1.0;
              let maxWinPct = -1.0;

              Object.entries(opponentStats).forEach(([opp, st]) => {
                if (st.total >= 3) {
                  const pct = st.wins / st.total;
                  if (pct < minWinPct) {
                    minWinPct = pct;
                    nemesis = { name: opp, ...st, pct };
                  }
                  if (pct > maxWinPct) {
                    maxWinPct = pct;
                    favoriteMatchup = { name: opp, ...st, pct };
                  }
                }
              });

              // Calculate 2026 current season team info
              const live2026Team = (liveData.standings || []).find(s => s.canonical_name === mName) || {};

              return (
                <div>
                  {/* HEADER */}
                  {(() => {
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
                        <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'var(--bg-primary)', border: '2px solid #fde68a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.75rem', fontWeight: '800', color: '#fde68a', overflow: 'hidden', position: 'relative' }}>
                          <span>{mName.charAt(0)}</span>
                        </div>
                        <div>
                          <h2 style={{ color: 'var(--text-primary)', margin: 0, fontSize: '1.6rem', fontWeight: '800' }}>{mName}</h2>
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                            Career Record: <strong style={{ color: '#fde68a' }}>{summary.all_time_record || '0-0-0'}</strong> ({((summary.regular_season_win_pct || 0) * 100).toFixed(1)}% Reg Win)
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* 2026 CURRENT SEASON CARD */}
                  {live2026Team.roster_id && (
                    <div style={{ backgroundColor: 'rgba(217, 119, 6, 0.1)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.85rem 1.15rem', marginBottom: '1.25rem' }}>
                      <div style={{ fontSize: '0.75rem', color: '#fde68a', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                        2026 Season Status
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <div>
                          <div style={{ fontWeight: '800', fontSize: '1.1rem', color: '#fde68a' }}>{live2026Team.team_name || live2026Team.canonical_name}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{live2026Team.division_name || (liveData?.division_names && liveData.division_names[live2026Team.division]) || `Division ${live2026Team.division || 1}`}</div>
                        </div>
                        <div style={{ display: 'flex', gap: '1.25rem', textAlign: 'right' }}>
                          <div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Rank</div>
                            <div style={{ fontWeight: '800', color: live2026Team.rank <= 6 ? 'var(--accent-green)' : 'var(--danger-red)' }}>#{live2026Team.rank}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Record</div>
                            <div style={{ fontWeight: '800', color: 'var(--text-primary)' }}>{live2026Team.wins}-{live2026Team.losses}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Points For</div>
                            <div style={{ fontWeight: '800', color: '#fde68a' }}>{Number(live2026Team.points_for || 0).toFixed(2)}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* CAREER BADGES & ACCOMPLISHMENTS */}
                  <div style={{ marginBottom: '1.5rem' }}>
                    <h4 style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>
                      Trophy Case & Badges
                    </h4>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      {champs.length > 0 && (
                        <div style={{ backgroundColor: 'rgba(34, 197, 94, 0.15)', border: '1px solid var(--accent-green)', borderRadius: '0.375rem', padding: '0.4rem 0.75rem', fontSize: '0.8125rem', fontWeight: '700', color: 'var(--accent-green)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <Trophy size={16} /> {champs.length}x League Champion ({champs.map(c => c.season).join(', ')})
                        </div>
                      )}
                      {(playoff.championship_appearances || 0) > 0 && (
                        <div style={{ backgroundColor: 'rgba(59, 130, 246, 0.15)', border: '1px solid var(--accent-blue)', borderRadius: '0.375rem', padding: '0.4rem 0.75rem', fontSize: '0.8125rem', fontWeight: '700', color: 'var(--accent-blue)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <Award size={16} /> {playoff.championship_appearances}x Championship Finalist
                        </div>
                      )}
                      {(playoff.playoff_appearances || summary.playoff_appearances || 0) > 0 && (
                        <div style={{ backgroundColor: 'rgba(253, 230, 138, 0.15)', border: '1px solid #fde68a', borderRadius: '0.375rem', padding: '0.4rem 0.75rem', fontSize: '0.8125rem', fontWeight: '700', color: '#fde68a', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <Flame size={16} /> {playoff.playoff_appearances || summary.playoff_appearances} Playoff Appearances
                        </div>
                      )}
                      {summary.highest_score && (
                        <div style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '0.375rem', padding: '0.4rem 0.75rem', fontSize: '0.8125rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                          High Score: <strong>{summary.highest_score} pts</strong>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* RIVALRIES: NEMESIS & FAVORITE MATCHUP */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div style={{ backgroundColor: 'var(--bg-primary)', padding: '1rem', borderRadius: '0.5rem', border: '1px solid var(--danger-border)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--danger-red)', fontWeight: '800', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                        Toughest Nemesis
                      </div>
                      {nemesis ? (
                        <div>
                          <div style={{ fontWeight: '800', fontSize: '1.1rem', color: 'var(--text-primary)' }}>{nemesis.name}</div>
                          <div style={{ fontSize: '0.8125rem', color: 'var(--danger-red)', fontWeight: '700', marginTop: '0.25rem' }}>
                            {nemesis.wins} - {nemesis.losses} Record ({ (nemesis.pct * 100).toFixed(0) }% Win)
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No established nemesis (min 3 games)</div>
                      )}
                    </div>

                    <div style={{ backgroundColor: 'var(--bg-primary)', padding: '1rem', borderRadius: '0.5rem', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--accent-green)', fontWeight: '800', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                        Favorite Opponent
                      </div>
                      {favoriteMatchup ? (
                        <div>
                          <div style={{ fontWeight: '800', fontSize: '1.1rem', color: 'var(--text-primary)' }}>{favoriteMatchup.name}</div>
                          <div style={{ fontSize: '0.8125rem', color: 'var(--accent-green)', fontWeight: '700', marginTop: '0.25rem' }}>
                            {favoriteMatchup.wins} - {favoriteMatchup.losses} Record ({ (favoriteMatchup.pct * 100).toFixed(0) }% Win)
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No established favorite (min 3 games)</div>
                      )}
                    </div>
                  </div>

                  {/* CAREER PLAYOFF STATS BREAKDOWN */}
                  <div style={{ backgroundColor: 'var(--bg-primary)', padding: '1rem', borderRadius: '0.5rem', border: '1px solid var(--border-color)' }}>
                    <h4 style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>
                      Playoff Resume
                    </h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', textAlign: 'center' }}>
                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Playoff Record</div>
                        <div style={{ fontWeight: '800', fontSize: '1rem', color: 'var(--text-primary)' }}>
                          {playoff.playoff_wins || 0} - {playoff.playoff_losses || 0}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Playoff Win %</div>
                        <div style={{ fontWeight: '800', fontSize: '1rem', color: 'var(--accent-green)' }}>
                          {((playoff.playoff_win_pct || 0) * 100).toFixed(1)}%
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Round 2 Apps</div>
                        <div style={{ fontWeight: '800', fontSize: '1rem', color: 'var(--accent-blue)' }}>
                          {playoff.round2_appearances || 0}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Champ Ring</div>
                        <div style={{ fontWeight: '800', fontSize: '1rem', color: 'var(--accent-amber)' }}>
                          {playoff.championship_wins || 0}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
      {/* CALENDAR PHOTO THEATER MODE MODAL */}
      {activePhotoMonth !== null && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(8px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem'
          }}
          onClick={() => setActivePhotoMonth(null)}
        >
          <div 
            style={{
              position: 'relative',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '0.5rem',
              maxWidth: '1200px',
              width: '94vw',
              maxHeight: '94vh',
              overflow: 'hidden',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)',
              display: 'flex',
              flexDirection: 'column'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '800', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Camera size={18} color="var(--danger-red)" />
                Aryan's Punishment Calendar — {MONTH_NAMES_MAP[activePhotoMonth]?.full || `Month ${activePhotoMonth}`}
              </h3>
              <button
                onClick={() => setActivePhotoMonth(null)}
                style={{
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '0.25rem'
                }}
              >
                <X size={22} />
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', justifyContent: 'center', backgroundColor: '#090b0e' }}>
              <img
                src={`/calendar/month_${activePhotoMonth}.jpg`}
                alt={`Aryan's Calendar Shoot Month ${activePhotoMonth}`}
                style={{ maxWidth: '100%', maxHeight: '82vh', objectFit: 'contain', borderRadius: '0.375rem' }}
              />
            </div>

            <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                onClick={() => setActivePhotoMonth(prev => prev > 1 ? prev - 1 : 12)}
                style={{
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                  padding: '0.4rem 0.85rem',
                  borderRadius: '0.375rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  fontSize: '0.8rem'
                }}
              >
                ← Previous Month
              </button>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: '600' }}>
                Month {activePhotoMonth} of 12
              </span>
              <button
                onClick={() => setActivePhotoMonth(prev => prev < 12 ? prev + 1 : 1)}
                style={{
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                  padding: '0.4rem 0.85rem',
                  borderRadius: '0.375rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  fontSize: '0.8rem'
                }}
              >
                Next Month →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

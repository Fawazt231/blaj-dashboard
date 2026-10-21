import React, { useEffect, useMemo, useRef, useState } from 'react';
import Cpu from 'lucide-react/dist/esm/icons/cpu';
import Play from 'lucide-react/dist/esm/icons/play';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import X from 'lucide-react/dist/esm/icons/x';
import { collectCompletedWeeklyScores } from './simulationInputs.js';

const OUTCOMES = [
  ['playoff', 'Makes playoffs'],
  ['bye', 'Earns a bye'],
  ['divisionWinner', 'Wins division'],
  ['miss', 'Misses playoffs'],
  ['last', 'Finishes last']
];
const COUNTS = [10000, 50000, 100000, 500000, 1000000];
const pct = value => value == null ? 'N/A' : `${Number(value).toFixed(value < 1 ? 3 : 1)}%`;
const num = value => value == null ? 'N/A' : Number(value).toFixed(1);
const signed = value => value == null ? 'N/A' : `${value >= 0 ? '+' : ''}${Number(value).toFixed(2)}`;
const compactProbability = value => {
  if (value == null) return 'N/A';
  if (value < 0.001) return '<0.001';
  return Number(value).toFixed(value < 0.01 ? 3 : value < 0.1 ? 2 : 1);
};
const ordinal = value => {
  if (value == null) return 'N/A';
  const rank = Math.round(Number(value));
  const suffix = rank % 100 >= 11 && rank % 100 <= 13 ? 'th'
    : rank % 10 === 1 ? 'st'
      : rank % 10 === 2 ? 'nd'
        : rank % 10 === 3 ? 'rd' : 'th';
  return `${rank}${suffix}`;
};

function InfoTip({ label, children }) {
  return (
    <details className="explorer-info">
      <summary aria-label={`About ${label}`} title={`About ${label}`}>i</summary>
      <div className="explorer-info-popover" role="note">
        <strong>{label}</strong>
        <span>{children}</span>
      </div>
    </details>
  );
}

function SectionTitle({ children, info }) {
  return (
    <div className="card-title explorer-title-row">
      <span>{children}</span>
      <InfoTip label={children}>{info}</InfoTip>
    </div>
  );
}

function EvidenceKey() {
  return (
    <div className="explorer-evidence-key">
      <span><strong>Strong:</strong> adjusted q ≤ 0.05, 95% interval excludes zero, difference ≥ 0.50 points, and at least 200 outcome hits on both sides.</span>
      <span><strong>Suggestive:</strong> adjusted q ≤ 0.05 and interval excludes zero, but the effect is smaller or one side has fewer than 200 outcome hits.</span>
      <span><strong>Unclear:</strong> the adjusted test or interval cannot rule out Monte Carlo noise.</span>
    </div>
  );
}

function EvidenceBadge({ value }) {
  return <span className={`explorer-evidence explorer-evidence-${value.toLowerCase()}`}>{value}</span>;
}

function SummaryCard({ label, value, detail, info }) {
  return (
    <div className="explorer-summary-card">
      <div className="explorer-label explorer-title-row">
        <span>{label}</span>
        <InfoTip label={label}>{info}</InfoTip>
      </div>
      <div className="explorer-value">{value}</div>
      {detail && <div className="explorer-detail">{detail}</div>}
    </div>
  );
}

export default function SimulationExplorer({ liveData, excelData }) {
  const completedScores = useMemo(() => collectCompletedWeeklyScores(
    liveData?.matchups_by_week,
    liveData?.current_week
  ), [liveData]);
  const teams = useMemo(() => {
    const proxies = excelData?.PerManagerSummary || [];
    return (liveData?.standings || []).map(team => {
      const proxy = proxies.find(item => item.manager === team.canonical_name);
      return {
        name: team.canonical_name,
        display: team.team_name || team.canonical_name,
        wins: Number(team.wins || 0),
        losses: Number(team.losses || 0),
        fpts: Number(team.points_for || 0),
        division: team.division || 1,
        weeklyScores: completedScores[team.canonical_name] || [],
        historicalAvg: proxy ? Math.max(100, Number(proxy.highest_score || 0) * 0.7) : 110
      };
    });
  }, [liveData, excelData, completedScores]);

  const scheduleMeta = useMemo(() => {
    const schedule = [];
    const currentWeek = Number(liveData?.current_week || 1);
    Object.entries(liveData?.matchups_by_week || {}).forEach(([weekKey, pairs]) => {
      const week = Number(weekKey);
      if (week < currentWeek) return;
      (pairs || []).forEach(pair => {
        if (!Array.isArray(pair) || pair.length < 2) return;
        const away = pair[0].team_info?.canonical_name;
        const home = pair[1].team_info?.canonical_name;
        if (away && home) schedule.push({ week, away, home });
      });
    });
    return schedule.sort((a, b) => a.week - b.week);
  }, [liveData]);

  const [teamName, setTeamName] = useState('');
  const [outcome, setOutcome] = useState('miss');
  const [simulations, setSimulations] = useState(100000);
  const [seed, setSeed] = useState(231);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const workerRef = useRef(null);

  useEffect(() => {
    if (!teamName && teams.length) setTeamName(teams[0].name);
  }, [teams, teamName]);
  useEffect(() => () => workerRef.current?.terminate(), []);

  const displayByName = useMemo(() => new Map(teams.map(team => [team.name, team.display])), [teams]);
  const selectedTeam = teams.find(team => team.name === teamName);
  const selectedOutcome = OUTCOMES.find(([key]) => key === outcome)?.[1] || outcome;
  const activeScenario = result?.representativeScenarios?.[scenarioIndex] || null;
  const targetSchedule = scheduleMeta.filter(game => game.away === teamName || game.home === teamName);

  const changeInput = setter => event => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setRunning(false);
    setResult(null);
    setError('');
    setNotice('');
    setScenarioIndex(0);
    setter(event);
  };

  const startWorker = (trialCount, canRetry = true) => {
    const worker = new Worker(new URL('./simulationExplorerWorker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    setRunning(true);
    worker.onmessage = event => {
      if (event.data.type === 'result') {
        setResult(event.data.result);
      } else {
        setError(event.data.message || 'Simulation analysis failed inside the worker.');
      }
      setRunning(false);
      worker.terminate();
      workerRef.current = null;
    };
    worker.onerror = event => {
      worker.terminate();
      workerRef.current = null;
      if (canRetry && trialCount > 100000) {
        const retryCount = Math.max(100000, Math.floor(trialCount / 2));
        setNotice(`The browser stopped the ${trialCount.toLocaleString()}-trial worker, usually because of a device memory limit. Retrying automatically with ${retryCount.toLocaleString()} trials.`);
        startWorker(retryCount, false);
        return;
      }
      setError(event.message || 'The browser could not start or complete the simulation worker. Refresh the page, then try 100,000 trials.');
      setRunning(false);
    };
    worker.postMessage({
      teams,
      remainingSchedule: scheduleMeta.map(game => [game.away, game.home]),
      targetName: teamName,
      outcome,
      simulations: trialCount,
      seed,
      model: 'Bayesian',
      priorStd: 25,
      minSigma: 20,
      divisions: liveData?.divisions || {}
    });
  };

  const run = () => {
    if (!selectedTeam || !scheduleMeta.length) return;
    workerRef.current?.terminate();
    setError('');
    setNotice('');
    setResult(null);
    setScenarioIndex(0);
    startWorker(simulations);
  };

  const cancel = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setRunning(false);
    setNotice('Analysis cancelled.');
  };

  if (!liveData || !excelData) return <div className="card">Loading Simulation Explorer…</div>;

  return (
    <main className="explorer-page">
      <section className="card explorer-hero">
        <div>
          <div className="card-title"><Cpu size={20} color="var(--accent-amber)" /> Simulation Explorer</div>
          <h2>What tends to happen when an outcome occurs?</h2>
          <p>Deterministic conditional analysis of records, scoring, qualification routes, leverage games, rival associations, outcome rates, and representative seasons.</p>
        </div>
        <div className="explorer-controls">
          <label>Team
            <select value={teamName} onChange={changeInput(event => setTeamName(event.target.value))}>
              {teams.map(team => <option key={team.name} value={team.name}>{team.display} ({team.name})</option>)}
            </select>
          </label>
          <label>Outcome
            <select value={outcome} onChange={changeInput(event => setOutcome(event.target.value))}>
              {OUTCOMES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label>Trials
            <select value={simulations} onChange={changeInput(event => setSimulations(Number(event.target.value)))}>
              {COUNTS.map(count => <option key={count} value={count}>{count.toLocaleString()}</option>)}
            </select>
          </label>
          <label>Seed
            <input type="number" value={seed} onChange={changeInput(event => setSeed(Number(event.target.value) || 1))} />
          </label>
          <button className="explorer-run" onClick={run} disabled={running || !teamName}>
            {running ? <RefreshCw size={17} className="spin" /> : <Play size={17} />}
            {running ? 'Analyzing…' : 'Run Explorer'}
          </button>
          {running && <button className="explorer-cancel" onClick={cancel}><X size={16} /> Cancel</button>}
        </div>
      </section>

      {error && <div className="explorer-warning">{error}</div>}
      {notice && <div className="explorer-notice">{notice}</div>}
      {!result && !running && !error && (
        <section className="card explorer-empty">
          Choose a team and outcome, then run the explorer. Use 500,000–1,000,000 trials for very rare outcomes.
        </section>
      )}
      {running && <section className="card explorer-empty"><RefreshCw size={28} className="spin" /> Running {simulations.toLocaleString()} background trials…</section>}

      {result && (
        <>
          <section className="explorer-summary-grid">
            <SummaryCard label={selectedOutcome} value={pct(result.probability)} detail={`${result.sampleSize.toLocaleString()} of ${result.simulations.toLocaleString()} trials · 95% interval ${pct(result.confidence95.low)}–${pct(result.confidence95.high)}`} info="How often the selected outcome occurred across all simulated seasons. The 95% interval shows the uncertainty caused by using a finite number of trials." />
            <SummaryCard label="Typical final record" value={`${num(result.profile.conditional.wins.median)} wins`} detail={`10th–90th: ${num(result.profile.conditional.wins.p10)}–${num(result.profile.conditional.wins.p90)}`} info="The median final win total among simulations where the selected outcome happened. The range contains the middle 80% of those matching trials." />
            <SummaryCard label="Typical final PF" value={num(result.profile.conditional.fpts.median)} detail={`10th–90th: ${num(result.profile.conditional.fpts.p10)}–${num(result.profile.conditional.fpts.p90)}`} info="The median final points-for total among simulations where the selected outcome happened. The range contains the middle 80% of those matching trials." />
            <SummaryCard label="Projected placement" value={ordinal(result.profile.all.placement.median)} detail={`Overall 10th–90th: ${ordinal(result.profile.all.placement.p10)}–${ordinal(result.profile.all.placement.p90)} · When outcome occurs: ${ordinal(result.profile.conditional.placement.median)}`} info="The team's median regular-season placement across all simulations, ranked by wins and then PF. The detail also shows its typical placement only in trials where the selected outcome happened. This is overall standing, not playoff seed." />
            {['playoff', 'miss'].includes(result.outcome)
              ? <SummaryCard label="PF qualifier margin" value={signed(result.profile.conditional.pointsCutoffMargin.median)} detail={`10th–90th: ${signed(result.profile.conditional.pointsCutoffMargin.p10)} to ${signed(result.profile.conditional.pointsCutoffMargin.p90)} · At/above line: ${pct(result.profile.conditional.pointsCutoffMargin.atOrAbovePct)}`} info="The selected team's final PF minus the second points-based qualifier's PF in matching trials. Positive means it finished above that line; negative means below it. At/above includes trials tied with the cutoff. Division and record routes can qualify without clearing this line." />
              : <SummaryCard label="Remaining-season wins" value={num(result.profile.conditional.remainingWins.median)} detail={`10th–90th: ${num(result.profile.conditional.remainingWins.p10)}–${num(result.profile.conditional.remainingWins.p90)}`} info="The median number of additional games won from now through Week 14 when the selected outcome happened." />}
          </section>

          {result.sampleSize < 100 && (
            <div className="explorer-warning">Only {result.sampleSize} matching trials were observed. Increase the trial count before treating these patterns as stable.</div>
          )}

          <section className="explorer-analysis-stack">
            <div className="card">
              <SectionTitle info="Compares the selected outcome rate when this team wins each remaining game versus when it loses. Difference is win minus loss in percentage points. The interval measures Monte Carlo uncertainty, and q adjusts for testing every remaining game. It includes both the record and scoring associated with the simulated result.">Highest-leverage games</SectionTitle>
              <EvidenceKey />
              <div className="table-container"><table className="data-table explorer-leverage-table"><thead><tr><th>Game</th><th>After win</th><th>After loss</th><th>Difference</th><th>Evidence</th></tr></thead><tbody>
                {result.gameLeverage.slice(0, 8).map(item => {
                  const game = scheduleMeta[item.index];
                  return <tr key={item.index}>
                    <td>W{game?.week} vs {displayByName.get(item.opponent) || item.opponent}<small>{item.outcomeWithWin.toLocaleString()} hits after wins · {item.outcomeWithLoss.toLocaleString()} after losses</small></td>
                    <td>{pct(item.withWin)}</td>
                    <td>{pct(item.withLoss)}</td>
                    <td>{signed(item.difference)} pts<small>95%: {signed(item.differenceInterval.low)} to {signed(item.differenceInterval.high)}<br />q={compactProbability(item.qValue)}</small></td>
                    <td><EvidenceBadge value={item.evidence} /></td>
                  </tr>;
                })}
              </tbody></table></div>
            </div>
            <div className="card">
              <SectionTitle info="Directly compares the selected outcome rate when a rival condition happens with the rate when it does not. The difference is condition minus complement. The interval measures Monte Carlo uncertainty, and q is a false-discovery-rate-adjusted significance value across all rival comparisons. Association does not prove causation.">Strongest rival associations</SectionTitle>
              <EvidenceKey />
              <div className="table-container"><table className="data-table explorer-association-table"><thead><tr><th>Condition</th><th>When true</th><th>When false</th><th>Difference</th><th>Evidence</th></tr></thead><tbody>
                {result.rivalDependencies.filter(item => item.samples >= Math.max(100, result.simulations / 1000)).slice(0, 8).map((item, index) => <tr key={`${item.rival}-${item.condition}-${index}`}>
                  <td>{displayByName.get(item.rival) || item.rival} {item.condition}<small>{item.hits.toLocaleString()} outcome hits / {item.samples.toLocaleString()} trials</small></td>
                  <td>{pct(item.probability)}</td>
                  <td>{pct(item.complementProbability)}</td>
                  <td>{signed(item.difference)} pts<small>95%: {signed(item.differenceInterval.low)} to {signed(item.differenceInterval.high)}<br />q={compactProbability(item.qValue)}</small></td>
                  <td><EvidenceBadge value={item.evidence} /></td>
                </tr>)}
              </tbody></table></div>
            </div>
          </section>

          <section className="explorer-two-column">
            <div className="card">
              <SectionTitle info="Groups all simulations by the team's final win total, then reports how often the selected outcome occurred within each group. These are observed simulated rates, not guaranteed qualification cutoffs.">Observed outcome rate by final wins</SectionTitle>
              <div className="table-container"><table className="data-table"><thead><tr><th>Wins</th><th>Probability</th><th>Trials</th></tr></thead><tbody>
                {result.thresholds.wins.map(item => <tr key={item.wins}><td>{item.wins}</td><td>{pct(item.probability)}<small className="explorer-cell-note">95%: {pct(item.confidence95.low)}–{pct(item.confidence95.high)}</small></td><td>{item.total.toLocaleString()}</td></tr>)}
              </tbody></table></div>
            </div>
            <div className="card">
              <SectionTitle info="Groups all simulations into 25-point final-PF ranges, then reports how often the selected outcome occurred within each range. Trials shows the sample size behind each percentage.">Observed outcome rate by final PF</SectionTitle>
              <div className="table-container"><table className="data-table"><thead><tr><th>PF range</th><th>Probability</th><th>Trials</th></tr></thead><tbody>
                {result.thresholds.pointsFor.filter(item => item.total >= Math.max(10, result.simulations / 10000)).map(item => <tr key={item.floor}><td>{item.floor}–{item.ceiling.toFixed(0)}</td><td>{pct(item.probability)}<small className="explorer-cell-note">95%: {pct(item.confidence95.low)}–{pct(item.confidence95.high)}</small></td><td>{item.total.toLocaleString()}</td></tr>)}
              </tbody></table></div>
            </div>
          </section>

          <section className="card">
            <SectionTitle info="The most frequent sequences of wins and losses among simulations where the selected outcome happened. Each letter corresponds to the opponents listed below in chronological order.">Most common multi-game paths</SectionTitle>
            <div className="explorer-path-key">{targetSchedule.map(game => `W${game.week} ${displayByName.get(game.away === teamName ? game.home : game.away) || (game.away === teamName ? game.home : game.away)}`).join(' → ')}</div>
            <div className="explorer-paths">
              {result.commonPaths.slice(0, 8).map(item => <div key={item.path}><strong>{item.path}</strong><span>{item.count.toLocaleString()} · {pct(item.pct)}</span></div>)}
            </div>
          </section>

          {result.representativeScenarios.length > 0 && (
            <section className="card">
              <SectionTitle info="The Typical scenario is closest to the matching trials' median record, PF and placement. The other examples prioritize different qualification routes or meaningfully different win/loss paths. Candidates are sampled uniformly across the full run, and all choices remain reproducible for the same seed.">Representative scenarios</SectionTitle>
              <div className="explorer-scenario-tabs">
                {result.representativeScenarios.map((scenario, index) => <button key={scenario.trial} className={scenarioIndex === index ? 'active' : ''} onClick={() => setScenarioIndex(index)}>{scenario.archetype || `Scenario ${index + 1}`}</button>)}
              </div>
              {activeScenario && <div className="explorer-two-column">
                <div className="table-container"><table className="data-table"><thead><tr><th>#</th><th>Team</th><th>Record</th><th>PF</th><th>Status</th></tr></thead><tbody>
                  {activeScenario.standings.map(row => <tr key={row.name}><td>{row.rank}</td><td>{displayByName.get(row.name) || row.name}</td><td>{row.wins}–{row.losses}</td><td>{row.fpts.toFixed(1)}</td><td>{row.playoff ? 'Playoff' : 'Miss'}</td></tr>)}
                </tbody></table></div>
                <div className="table-container"><table className="data-table"><thead><tr><th>Week</th><th>Opponent</th><th>Result</th><th>Score</th></tr></thead><tbody>
                  {activeScenario.games.map(game => { const meta = scheduleMeta[game.index]; return <tr key={game.index}><td>{meta?.week}</td><td>{displayByName.get(game.opponent) || game.opponent}</td><td>{game.result}</td><td>{game.targetScore.toFixed(1)}–{game.opponentScore.toFixed(1)}</td></tr>; })}
                </tbody></table></div>
              </div>}
            </section>
          )}
        </>
      )}
    </main>
  );
}

import React, { useEffect, useMemo, useState } from 'react';

const OUTCOMES = [
  ['playoff', 'Makes playoffs'],
  ['bye', 'Earns a bye'],
  ['divisionWinner', 'Wins division'],
  ['last', 'Finishes last']
];
const percent = value => `${Number(value || 0).toFixed(1)}%`;
const decimal = value => Number(value || 0).toFixed(3);

export default function HistoricalBacktest() {
  const [data, setData] = useState(null);
  const [outcome, setOutcome] = useState('playoff');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/data/historical_backtest.json')
      .then(response => {
        if (!response.ok) throw new Error('Historical backtest data is unavailable.');
        return response.json();
      })
      .then(value => active && setData(value))
      .catch(reason => active && setError(reason.message));
    return () => { active = false; };
  }, []);

  const metric = data?.metrics?.[outcome];
  const calibrationError = useMemo(() => {
    if (!metric) return null;
    const total = metric.calibration.reduce((sum, bucket) => sum + bucket.forecasts, 0);
    return total ? metric.calibration.reduce((sum, bucket) => (
      sum + bucket.forecasts * Math.abs(bucket.observedRate - bucket.meanPrediction)
    ), 0) / total : null;
  }, [metric]);
  const label = OUTCOMES.find(([key]) => key === outcome)?.[1] || outcome;
  const exampleBucket = useMemo(() => metric?.calibration.reduce((best, bucket) => (
    !best || bucket.forecasts > best.forecasts ? bucket : best
  ), null), [metric]);

  if (error) return <section className="card explorer-warning">{error}</section>;
  if (!data || !metric) return <section className="card explorer-empty">Loading historical model backtest…</section>;

  return (
    <section className="card backtest-card">
      <div className="backtest-header">
        <div>
          <div className="card-title">Historical model backtest</div>
          <h2>Did probabilities behave like probabilities?</h2>
          <p>{data.checkpoints} reconstructed weekly checkpoints from {data.seasons[0]}–{data.seasons.at(-1)}, using only information available through each historical week.</p>
        </div>
        <label>Outcome
          <select value={outcome} onChange={event => setOutcome(event.target.value)}>
            {OUTCOMES.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
          </select>
        </label>
      </div>

      <details className="backtest-guide" open>
        <summary>How to read this backtest</summary>
        <div className="backtest-guide-grid">
          <div><strong>1. Recreate the past</strong><span>At the end of each historical week, the simulator sees only scores, records, and schedule information that existed then.</span></div>
          <div><strong>2. Save each probability</strong><span>One forecast means one team at one weekly checkpoint—for example, a 70% chance to make the playoffs after Week 6.</span></div>
          <div><strong>3. Compare with reality</strong><span>After the season, that probability is compared with the actual yes-or-no result. Confident wrong forecasts receive the largest penalty.</span></div>
          <div><strong>4. Group similar forecasts</strong><span>If probabilities are calibrated, teams given about 70% odds should actually achieve the outcome about 70% of the time.</span></div>
        </div>
        <div className="backtest-score-help">
          <p><strong>Brier score:</strong> the average squared probability error. Zero is perfect; lower is better.</p>
          <p><strong>Uninformed baseline:</strong> the score from giving every team the league-wide rate, such as 50% for a six-of-twelve playoff field.</p>
          <p><strong>Error reduction:</strong> how much error the model removed relative to that baseline. Positive is useful; larger is better.</p>
          <p><strong>Calibration error:</strong> the typical absolute difference between displayed probabilities and observed results. Zero is perfect.</p>
        </div>
      </details>

      <div className="backtest-summary-grid">
        <div><span>Brier score</span><strong>{decimal(metric.brier)}</strong><small>Overall probability error · lower is better</small></div>
        <div><span>Uninformed baseline</span><strong>{decimal(metric.uninformedBrier)}</strong><small>The no-information comparison score</small></div>
        <div><span>Error reduction</span><strong>{percent(metric.brierSkillScore * 100)}</strong><small>Error removed versus the baseline</small></div>
        <div><span>Average calibration gap</span><strong>{percent(calibrationError)}</strong><small>Typical displayed-versus-observed difference</small></div>
      </div>

      <div className="backtest-verdict">
        <strong>{label}:</strong> the model reduced squared probability error by {percent(metric.brierSkillScore * 100)} versus a constant {percent(metric.observedBaseRate)} forecast.
        {' '}Its average calibration gap was {percent(calibrationError)}; individual probability bands below show where it was over- or underconfident.
      </div>

      {exampleBucket && (() => {
        const gap = exampleBucket.observedRate - exampleBucket.meanPrediction;
        return <div className="backtest-example">
          <strong>Concrete example:</strong> The model produced {exampleBucket.forecasts.toLocaleString()} {exampleBucket.range} forecasts. Their average was {percent(exampleBucket.meanPrediction)}, and {label.toLowerCase()} actually occurred {percent(exampleBucket.observedRate)} of the time. Because reality was {Math.abs(gap).toFixed(1)} points {gap >= 0 ? 'higher' : 'lower'}, the model <strong>{gap >= 0 ? 'underestimated' : 'was overconfident about'}</strong> this group.
        </div>;
      })()}

      <div className="backtest-table-intro">
        <strong>Reading the table:</strong> positive gaps mean the outcome happened more often than predicted; negative gaps mean it happened less often. “Close” means the difference was under five percentage points.
      </div>

      <div className="table-container">
        <table className="data-table backtest-table">
          <thead><tr><th>Probability band</th><th>Average forecast</th><th>Observed result rate</th><th>Actual − forecast</th><th>Interpretation</th><th>Team-week forecasts</th></tr></thead>
          <tbody>
            {metric.calibration.map(bucket => {
              const gap = bucket.observedRate - bucket.meanPrediction;
              const reading = Math.abs(gap) < 5 ? 'Close'
                : gap > 0 ? 'Underestimated' : 'Overconfident';
              return <tr key={bucket.range}>
                <td>{bucket.range}</td>
                <td>{percent(bucket.meanPrediction)}</td>
                <td>{percent(bucket.observedRate)}</td>
                <td className={Math.abs(gap) < 5 ? '' : gap > 0 ? 'backtest-positive' : 'backtest-negative'}>{gap >= 0 ? '+' : ''}{gap.toFixed(1)} pts</td>
                <td><span className={`backtest-reading backtest-${reading.toLowerCase()}`}>{reading}</span></td>
                <td>{bucket.forecasts.toLocaleString()}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      <p className="backtest-note">Reconstructed forecasts evaluate the current model fairly without future scores, but repeated weekly forecasts from the same team-season are related observations—not {data.teamForecasts.toLocaleString()} independent seasons.</p>
    </section>
  );
}

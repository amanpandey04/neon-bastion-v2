import { useEffect, useMemo, useRef, useState } from "react";
import { GameEngine } from "./game/GameEngine";
import { TOWER_TYPES } from "./game/data";
import { formatNumber } from "./game/utils";

const towerList = Object.values(TOWER_TYPES);

const experimentLabels = {
  spatialGrid: "Spatial grid target lookup",
  objectPool: "Object pool reuse",
};

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function App() {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    const engine = new GameEngine(canvasRef.current, (next) => setSnapshot(next));
    engineRef.current = engine;
    engine.start();
    engine.emitSnapshot(true);

    return () => {
      engine.destroy();
    };
  }, []);

  const engine = engineRef.current;
  const selected = snapshot?.selectedTower;
  const buildType = snapshot?.selectedBuildType;
  const buildData = buildType ? TOWER_TYPES[buildType] : null;

  const waveLabel = useMemo(() => {
    if (!snapshot) return "Loading";
    if (snapshot.stressMode) return "PERFORMANCE STRESS TEST";
    if (snapshot.victory) return "Victory";
    if (snapshot.gameOver) return "Game Over";
    if (snapshot.runningWave) return `Wave ${snapshot.wave}`;
    return snapshot.wave === 0 ? "Ready" : `Wave ${snapshot.wave} complete`;
  }, [snapshot]);

  return (
    <main className="app-shell">
      <section className="game-card">
        <header className="topbar">
          <div className="brand">
            <h1 className="game-title">
              <span>NEON</span> BASTION
            </h1>
            <div className="game-tagline">HOLD THE LINE</div>
          </div>

          <div className="stats">
            <Stat label="Credits" value={`₡${formatNumber(snapshot?.money ?? 0)}`} />
            <Stat label="Base" value={`${snapshot?.health ?? 0}/${snapshot?.maxHealth ?? 100}`} />
            <Stat label="Score" value={formatNumber(snapshot?.score ?? 0)} />
            <Stat label="Wave" value={`${snapshot?.wave ?? 0}/50`} />
          </div>
        </header>

        <div className="game-layout">
          <div className="canvas-wrap">
            <canvas
              ref={canvasRef}
              width={960}
              height={560}
              aria-label="Neon Bastion tower defense game board"
            />

            <div className="canvas-badges">
              <span className="status-badge">{waveLabel}</span>
              <span>{snapshot?.enemiesAlive ?? 0} enemies</span>
              <span>{snapshot?.towerCount ?? 0} towers</span>
              {snapshot?.stressMode && <span>{snapshot?.projectileCount ?? 0} projectiles</span>}
              {buildData && <span className="build-badge">Placing {buildData.name}</span>}
            </div>

            {(snapshot?.paused || snapshot?.victory || snapshot?.gameOver) && (
              <div className="overlay">
                <div className="overlay-panel">
                  <div className="overlay-kicker">
                    {snapshot.victory
                      ? "MISSION COMPLETE"
                      : snapshot.gameOver
                        ? "BASE LOST"
                        : "SYSTEM PAUSED"}
                  </div>

                  <h2>
                    {snapshot.victory
                      ? "You held the line."
                      : snapshot.gameOver
                        ? "The base is gone."
                        : "Take a breath."}
                  </h2>

                  <p>
                    {snapshot.victory
                      ? `All 50 waves are down. Final score: ${formatNumber(snapshot.score)}.`
                      : snapshot.gameOver
                        ? `You reached wave ${snapshot.wave}. Reinforce your weak spots and try again.`
                        : "The battlefield is frozen until you resume."}
                  </p>

                  <div className="overlay-actions">
                    <button
                      className="primary"
                      onClick={() =>
                        snapshot.paused ? engine.togglePause() : engine.resetGame()
                      }
                    >
                      {snapshot.paused ? "Resume" : "Play again"}
                    </button>

                    {!snapshot.paused && !snapshot.victory && !snapshot.gameOver && (
                      <button onClick={() => engine.resetGame()}>Restart</button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <aside className="sidebar">
            <section className="panel controls-panel">
              <div className="panel-heading-row">
                <div className="panel-title">Command</div>
                <span className="keyboard-hint">SPACE pause</span>
              </div>

              <div className="button-row">
                <button
                  className="primary"
                  disabled={!snapshot?.waveReady || snapshot?.victory || snapshot?.gameOver}
                  onClick={() => engine.startWave()}
                >
                  {snapshot?.wave === 0 ? "Start Wave" : "Next Wave"}
                </button>

                <button
                  onClick={() => engine.togglePause()}
                  disabled={snapshot?.victory || snapshot?.gameOver}
                >
                  {snapshot?.paused ? "Resume" : "Pause"}
                </button>

                <button onClick={() => engine.resetGame()}>Restart</button>
              </div>

              <div className="speed-row">
                <span>Speed</span>
                {[1, 2, 3].map((speed) => (
                  <button
                    key={speed}
                    className={snapshot?.speedMultiplier === speed ? "selected" : ""}
                    onClick={() => engine.setSpeed(speed)}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-title">Defense Systems</div>

              <div className="tower-grid">
                {towerList.map((tower) => (
                  <button
                    key={tower.id}
                    className={`tower-card ${buildType === tower.id ? "selected" : ""}`}
                    onClick={() => engine.selectBuildType(tower.id)}
                    disabled={snapshot?.victory || snapshot?.gameOver || snapshot?.stressMode}
                  >
                    <div
                      className="tower-icon"
                      style={{
                        borderColor: tower.color,
                        color: tower.color,
                      }}
                    >
                      {tower.name.slice(0, 1)}
                    </div>

                    <div className="tower-copy">
                      <strong>{tower.name}</strong>
                      <span>₡{tower.cost}</span>
                    </div>

                    <small>{tower.description}</small>
                  </button>
                ))}
              </div>

              <p className="hint">
                Click a tower, then place it on the battlefield. Green previews are valid, red previews are blocked.
              </p>
            </section>

            {selected && (
              <section className="panel tower-details">
                <div className="panel-title">Selected Tower</div>

                <div className="selected-title">
                  <strong>{selected.name}</strong>
                  <span>Level {selected.level}</span>
                </div>

                <div className="mini-stats">
                  <Stat label="Damage" value={Math.round(selected.damage)} />
                  <Stat label="Range" value={Math.round(selected.range)} />
                  <Stat label="Cooldown" value={`${selected.fireRate.toFixed(2)}s`} />
                  <Stat label="Kills" value={selected.kills} />
                </div>

                <div className="button-row">
                  <button
                    className="primary"
                    disabled={!selected.upgradeCost || snapshot.money < selected.upgradeCost}
                    onClick={() => engine.upgradeSelectedTower()}
                  >
                    {selected.upgradeCost ? `Upgrade ₡${selected.upgradeCost}` : "Max level"}
                  </button>

                  <button onClick={() => engine.sellSelectedTower()}>
                    Sell ₡{selected.sellValue}
                  </button>
                </div>
              </section>
            )}

            <section className="panel quick-help">
              <div className="panel-title">Field Manual</div>

              <div className="help-item">
                <span className="help-key">CLICK</span>
                <span>Choose a tower, then place it on the battlefield.</span>
              </div>

              <div className="help-item">
                <span className="help-key">ESC</span>
                <span>Cancel tower placement or selection.</span>
              </div>

              <div className="help-item">
                <span className="help-key">SPACE</span>
                <span>Pause or resume the battle.</span>
              </div>
            </section>

            <details className="dev-tools panel" open>
              <summary>
                <span>Performance Lab</span>
                <span className="summary-note">live A/B tests</span>
              </summary>

              <div className="dev-content">
                <div className="stress-workload">
                  <div className="workload-title">Assignment stress workload</div>
                  <div className="workload-grid">
                    <strong>5,000 <span>enemies</span></strong>
                    <strong>100 <span>towers</span></strong>
                    <strong>1,000 <span>projectiles</span></strong>
                  </div>
                </div>

                <div className="perf-grid">
                  <Stat label="Display FPS" value={Math.round(snapshot?.fps ?? 60)} />
                  <Stat label="Frame interval" value={`${(snapshot?.frameMs ?? 16.7).toFixed(1)}ms`} />
                  <Stat label="CPU work" value={`${(snapshot?.performance?.cpuFrameMs ?? 0).toFixed(2)}ms`} />
                  <Stat label="Update / render" value={`${(snapshot?.performance?.updateMs ?? 0).toFixed(2)} / ${(snapshot?.performance?.renderMs ?? 0).toFixed(2)}ms`} />
                </div>

                <div className="debug-timings">
                  <div>Enemies: {(snapshot?.performance?.enemiesMs ?? 0).toFixed(2)}ms</div>
                  <div>Towers: {(snapshot?.performance?.towersMs ?? 0).toFixed(2)}ms</div>
                  <div>Projectiles: {(snapshot?.performance?.projectilesMs ?? 0).toFixed(2)}ms</div>
                  <div>Pool sizes: {snapshot?.objectPoolSize ?? 0} / {snapshot?.projectilePoolSize ?? 0}</div>
                </div>

                <div className="lab-actions">
                  <button
                    className="stress"
                    onClick={() => engine.runStressBaseline()}
                    disabled={snapshot?.benchmark?.active}
                  >
                    Run Baseline
                  </button>

                  <button
                    className="primary"
                    onClick={() => engine.runStressTest()}
                    disabled={snapshot?.benchmark?.active}
                  >
                    Run Final 30s Benchmark
                  </button>
                </div>

                <div className="experiment-actions">
                  <div className="experiment-title">Live optimization experiments</div>
                  <p className="hint experiment-copy">
                    Each A/B run uses the exact stress workload and measures one targeted operation with the optimization disabled, then enabled.
                  </p>

                  <div className="experiment-grid">
                    <button onClick={() => engine.runPerformanceExperiment("spatialGrid")} disabled={snapshot?.benchmark?.active}>
                      A/B Spatial Grid
                    </button>
                    <button onClick={() => engine.runPerformanceExperiment("objectPool")} disabled={snapshot?.benchmark?.active}>
                      A/B Object Pool
                    </button>
                  </div>
                </div>

                {snapshot?.benchmark?.active && (
                  <div className="benchmark-box">
                    <div className="benchmark-status">
                      {snapshot.benchmark.kind === "experiment"
                        ? `${snapshot.benchmark.experimentStage === "before" ? "BEFORE" : "AFTER"} • ${experimentLabels[snapshot.benchmark.experimentId]}`
                        : snapshot.benchmark.kind === "baseline"
                          ? snapshot.benchmark.phase === "warmup"
                            ? "INITIAL-STYLE BASELINE • WARMING UP"
                            : "INITIAL-STYLE BASELINE • MEASURING"
                          : snapshot.benchmark.phase === "warmup"
                            ? "FINAL BENCHMARK • WARMING UP"
                            : "FINAL BENCHMARK • MEASURING"}
                    </div>

                    <div className="benchmark-progress">
                      {snapshot.benchmark.phase === "warmup"
                        ? `${snapshot.benchmark.warmupElapsed.toFixed(1)}s warm-up`
                        : `${snapshot.benchmark.measuredElapsed.toFixed(1)}s measured`}
                    </div>

                    {snapshot.benchmark.phase === "measuring" && (
                      <div className="benchmark-stats">
                        <div><span>FPS threshold</span><strong>{snapshot.benchmark.pass45FpsPercent.toFixed(1)}%</strong></div>
                        <div><span>&gt;33ms</span><strong>{snapshot.benchmark.over33msPercent.toFixed(1)}%</strong></div>
                      </div>
                    )}
                  </div>
                )}

                {snapshot?.benchmark?.complete && (
                  <div className="benchmark-box">
                    <div className="benchmark-result-title">
                      {snapshot.benchmark.kind === "experiment"
                        ? "A/B Experiment Complete"
                        : snapshot.benchmark.kind === "baseline"
                          ? "Baseline Complete"
                          : "30s Stress Test Complete"}
                    </div>

                    {snapshot.benchmark.kind === "experiment" && snapshot.benchmark.before && snapshot.benchmark.after ? (
                      <div className="ab-table">
                        <div className="ab-header"><span></span><strong>Before</strong><strong>After</strong></div>
                        <div><span>{snapshot.benchmark.before.metric}</span><strong>{snapshot.benchmark.before.averageCpuFrameMs.toFixed(2)}ms</strong><strong>{snapshot.benchmark.after.averageCpuFrameMs.toFixed(2)}ms</strong></div>
                        <div><span>Total measurement</span><strong>{snapshot.benchmark.before.totalMs.toFixed(2)}ms</strong><strong>{snapshot.benchmark.after.totalMs.toFixed(2)}ms</strong></div>
                        <div><span>Change</span><strong>—</strong><strong>{snapshot.benchmark.before.averageCpuFrameMs > 0 ? `${(((snapshot.benchmark.after.averageCpuFrameMs / snapshot.benchmark.before.averageCpuFrameMs) - 1) * 100).toFixed(1)}%` : "—"}</strong></div>
                      </div>
                    ) : (
                      <div className="benchmark-stats">
                        <div><span>Frames</span><strong>{snapshot.benchmark.totalFrames}</strong></div>
                        <div><span>Avg interval</span><strong>{snapshot.benchmark.averageFrameMs.toFixed(2)}ms</strong></div>
                        <div><span>Worst interval</span><strong>{snapshot.benchmark.worstFrameMs.toFixed(2)}ms</strong></div>
                        <div><span>CPU work</span><strong>{snapshot.benchmark.averageCpuFrameMs.toFixed(2)}ms</strong></div>
                        <div><span>≥45 FPS</span><strong>{snapshot.benchmark.pass45FpsPercent.toFixed(1)}%</strong></div>
                        <div><span>&gt;33ms</span><strong>{snapshot.benchmark.over33msPercent.toFixed(1)}%</strong></div>
                      </div>
                    )}

                    {snapshot.benchmark.kind === "final" && (
                      <div
                        className={
                          snapshot.benchmark.pass45FpsPercent >= 95 &&
                          snapshot.benchmark.over33msPercent < 5
                            ? "benchmark-pass"
                            : "benchmark-fail"
                        }
                      >
                        {snapshot.benchmark.pass45FpsPercent >= 95 && snapshot.benchmark.over33msPercent < 5
                          ? "PASS"
                          : "NEEDS WORK • TRY RUNNING AGAIN"}
                      </div>
                    )}
                  </div>
                )}

                <p className="hint">
                  A/B experiments isolate the operation being optimized. The final 30s test measures the browser&apos;s real RAF cadence for the assignment FPS thresholds.
                </p>
              </div>
            </details>
          </aside>
        </div>
      </section>
    </main>
  );
}

export default App;

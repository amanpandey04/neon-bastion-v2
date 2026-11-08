# Performance Numbers

## 1. Historical Initial LLM Baseline

The initial LLM-generated implementation was previously tested with the assignment workload:

- 5,000 enemies
- 100 towers
- 1,000 projectiles

The observed performance was approximately **10–20 FPS**. This is the historical initial breaking point, not a measurement from the current build.

---

## 2. Optimization Experiments

These are operation-level before/after measurements captured in the previous validation cycle. They measure the named operation, not whole-browser FPS.

### Spatial Grid

| Measurement | Before | After | Change |
|---|---:|---:|---:|
| 100 tower target-acquisition passes | 3.44 ms | 2.44 ms | **-29.1%** |
| Total measurement | 17.20 ms | 12.20 ms | **-29.1%** |

### Object Pool

| Measurement | Before | After | Change |
|---|---:|---:|---:|
| 5,000 acquire/release operations | 0.48 ms | 0.24 ms | **-50.0%** |
| Total measurement | 2.40 ms | 1.20 ms | **-50.0%** |

These A/B checks remain available because the assignment explicitly asks for before/after measurements for the optimizations used. They run only when manually started and do not run during normal gameplay.

---

## 3. Current Build: Final 20-Second Stress Test

The final benchmark uses a **3-second warm-up followed by 20 seconds of measurement**. It maintains the assignment workload:

- 5,000 active enemies
- 100 towers
- 1,000 active projectiles

Record the result from the current build here after running the test:

| Metric | Result |
|---|---:|
| Enemies | 5,000 |
| Towers | 100 |
| Projectiles | 1,000 |
| Frames | To be measured |
| Average frame interval | To be measured |
| Worst frame interval | To be measured |
| Average CPU work | To be measured |
| Frames at or above 45 FPS threshold | To be measured |
| Frames above 33 ms | To be measured |
| Result | To be measured |

The assignment thresholds are:

- At least **95%** of measured frames at or below **22.22 ms** (45 FPS or faster).
- Fewer than **5%** of measured frames above **33 ms**.

---

## 4. Measurement Method

The Performance Lab uses two separate measurements:

- **Browser frame interval:** the elapsed time between consecutive `requestAnimationFrame` callbacks. This is used for the assignment's FPS thresholds.
- **CPU work:** JavaScript time spent updating and rendering the game during one callback. This helps identify how much work the engine itself performs.

During the measured stress run, static tower platforms, rings, cores, and level badges are pre-rendered to a reusable offscreen layer; only the moving barrels are redrawn each frame. Background grid lines are combined into one Canvas path/stroke. Stress-mode enemy and projectile artwork is batched to reduce Canvas state changes, and the engine avoids work that is not required by the stress workload (such as scanning all 5,000 enemies for dead entities when stress projectiles do not apply damage). The full-scene background bitmap cache remains disabled because previous live measurements did not show a consistent improvement.

The benchmark duration advances using actual elapsed time between animation-frame callbacks; the fixed-step simulation keeps its separate 100ms delta cap for stability.

To prevent an off-screen canvas from producing an unrepresentative result:

1. Starting a test automatically scrolls the game canvas into view.
2. The benchmark waits until scrolling has settled and the canvas is substantially visible.
3. A 3-second warm-up begins only after the canvas is in view.
4. During measurement, the canvas must remain at least 72% visible in the viewport and the browser tab must remain active. Visibility is tracked with `IntersectionObserver`, avoiding a synchronous layout read on every animation frame.
5. A countdown is displayed over the battlefield so the operator can watch the game without scrolling to the Performance Lab.
6. If the canvas is scrolled away or the tab is hidden, the current measurement is discarded and the warm-up restarts when visibility is restored.
7. When the test completes, the page automatically scrolls to the Performance Lab results.

The final stress benchmark measures for 20 seconds after warm-up. The A/B checks time only the operation being compared, so their millisecond values should not be interpreted as browser FPS.

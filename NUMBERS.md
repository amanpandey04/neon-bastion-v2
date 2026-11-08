# Performance Numbers

## 1. Historical Initial LLM Baseline

The initial LLM implementation showed approximately **10–20 FPS** during early stress testing.

The intended stress workload was:

- 5,000 enemies
- 100 towers
- 1,000 projectiles

---

## 2. Optimization Experiments

These are operation-level before/after measurements from the final optimization evidence tests. They measure the named operation, not whole-browser FPS. Each total measurement represents five repetitions of the reported operation.

### Spatial Grid

| Measurement                         |   Before |    After |     Change |
| ----------------------------------- | -------: | -------: | ---------: |
| 100 tower target-acquisition passes |  6.22 ms |  4.16 ms | **-33.1%** |
| Total measurement (5 repetitions)   | 31.10 ms | 20.80 ms | **-33.1%** |

The spatial-grid experiment reduced the measured target-acquisition time by **33.1%**.

### Object Pool

| Measurement                       |  Before |   After |     Change |
| --------------------------------- | ------: | ------: | ---------: |
| 5,000 acquire/release operations  | 1.40 ms | 1.10 ms | **-21.4%** |
| Total measurement (5 repetitions) | 7.00 ms | 5.50 ms | **-21.4%** |

The object-pool experiment reduced the measured acquire/release time by **21.4%**.

These experiments are isolated operation-level comparisons. Their millisecond values should not be interpreted as browser FPS.

---

## 3. Final 20-Second Stress Test

The final benchmark uses a **3-second warm-up followed by 20 seconds of measurement**. The required workload is maintained during the measured run:

- 5,000 active enemies
- 100 towers
- 1,000 active projectiles

Four validation runs were captured with the battlefield visible.

| Metric                              |    Run 1 |    Run 2 |    Run 3 |    Run 4 |
| ----------------------------------- | -------: | -------: | -------: | -------: |
| Frames                              |    1,201 |    1,199 |    1,198 |    1,201 |
| Average frame interval              | 16.66 ms | 16.69 ms | 16.70 ms | 16.66 ms |
| Worst frame interval                | 17.10 ms | 33.30 ms | 33.40 ms | 17.20 ms |
| CPU work                            |  2.50 ms |  2.59 ms |  2.56 ms |  2.53 ms |
| Frames at or above 45 FPS threshold |   100.0% |    99.8% |    99.7% |   100.0% |
| Frames above 33 ms                  |     0.0% |     0.2% |     0.3% |     0.0% |
| Result                              | **PASS** | **PASS** | **PASS** | **PASS** |

### Four-run summary

| Aggregate metric                      |         Result |
| ------------------------------------- | -------------: |
| Average measured frames per run       |       1,199.75 |
| Mean average frame interval           |       16.68 ms |
| Highest worst-frame interval observed |       33.40 ms |
| Mean CPU work                         |        2.55 ms |
| Mean percentage at or above 45 FPS    |      **99.9%** |
| Mean percentage above 33 ms           |       **0.1%** |
| Passing runs                          | **4 out of 4** |

All four recorded runs met both performance thresholds:

- At least **95%** of measured frames at or below **22.22 ms** (45 FPS or faster).
- Fewer than **5%** of measured frames above **33 ms**.

---

## 4. Measurement Method

The Performance Lab reports two separate timing measurements:

- **Browser frame interval:** elapsed time between consecutive `requestAnimationFrame` callbacks. This is used to evaluate the assignment's FPS and frame-time thresholds.
- **CPU work:** JavaScript time spent updating and rendering the game during a callback. This helps identify the work performed by the game engine and is not presented as browser FPS.

The final benchmark:

1. Creates the required workload of 5,000 enemies, 100 towers, and 1,000 active projectiles.
2. Uses a 3-second warm-up before collecting results.
3. Measures browser frame intervals for 20 seconds.
4. Records CPU work separately from browser frame intervals.
5. Reports the percentage of frames at or below the 22.22 ms 45-FPS threshold and the percentage above 33 ms.
6. Requires the Canvas to remain substantially visible and the browser tab to remain active. If visibility is lost, the current measurement is discarded and the warm-up restarts.
7. Displays a countdown over the battlefield and scrolls to the results when the test completes.

---

## 5. Summary

- The initial LLM implementation exposed a significant performance problem, with historical results around **10–20 FPS**.
- Spatial-grid targeting reduced its measured operation time by **33.1%**.
- Object pooling reduced its measured acquire/release time by **21.4%**.
- The final implementation maintained the full **5,000 / 100 / 1,000** workload during testing.
- All four recorded 20-second final stress-test runs passed, averaging **99.9%** of frames at or above the 45-FPS threshold and **0.1%** above 33 ms.

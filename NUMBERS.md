# Performance Numbers

## 1. Historical Initial LLM Baseline

The initial LLM-generated implementation was tested with the assignment stress workload:

- 5,000 enemies
- 100 towers
- 1,000 projectiles

Observed performance was approximately **10–20 FPS** under the stress workload.

This was the initial breaking point that motivated the performance investigation and optimization work.

The game uses two kinds of measurements:

- **A/B experiments:** short CPU measurements of the specific operation being optimized, with the same stress dataset loaded.
- **Final stress benchmark:** real browser `requestAnimationFrame` cadence over 30 seconds for the assignment's FPS thresholds.

---

## 2. Current Controlled Baseline

The current Performance Lab baseline was measured with the same target workload while the selected optimization paths were disabled.

| Metric                              |     Result |
| ----------------------------------- | ---------: |
| Enemies                             |      5,000 |
| Towers                              |        100 |
| Projectiles                         |      1,000 |
| Frames                              |        219 |
| Average frame interval              |   18.34 ms |
| Worst frame interval                |   33.40 ms |
| CPU work                            |    3.58 ms |
| Frames at or above 45 FPS threshold |      90.0% |
| Frames above 33 ms                  |      10.0% |
| Result                              | Needs work |

The assignment target is at least **95% of frames at 45 FPS or higher** and fewer than **5% of frames above 33 ms**.

---

## 3. Optimization Experiments

A/B experiments isolate the selected operation so the before/after result is attributable to that code path rather than browser scheduling noise.

### Spatial Grid

The experiment measured 100 tower target-acquisition passes.

| Metric                              |   Before |      After |
| ----------------------------------- | -------: | ---------: |
| 100 tower target-acquisition passes |  3.44 ms |    2.44 ms |
| Total measurement                   | 17.20 ms |   12.20 ms |
| Change                              |        — | **-29.1%** |

The spatial grid reduced the measured target-acquisition time by **29.1%** in this experiment.

### Object Pool

The experiment measured 5,000 acquire/release operations.

| Metric                           |  Before |      After |
| -------------------------------- | ------: | ---------: |
| 5,000 acquire/release operations | 0.48 ms |    0.24 ms |
| Total measurement                | 2.40 ms |    1.20 ms |
| Change                           |       — | **-50.0%** |

The object pool reduced the measured acquire/release work by **50.0%** in this experiment.

---

## 4. Final 30-Second Stress Test

### Successful validation run

A successful 30-second run was captured during final validation with the required workload maintained:

| Metric                              |    Result |
| ----------------------------------- | --------: |
| Enemies                             |     5,000 |
| Towers                              |       100 |
| Projectiles                         |     1,000 |
| Frames                              |     1,757 |
| Average frame interval              |  17.08 ms |
| Worst frame interval                |  66.60 ms |
| CPU work                            |   2.49 ms |
| Frames at or above 45 FPS threshold | **97.8%** |
| Frames above 33 ms                  |  **2.2%** |
| Result                              |  **PASS** |

This run satisfies both performance thresholds specified in the assignment.

### Latest repeat run

A later repeat of the same 30-second test produced:

| Metric                              |     Result |
| ----------------------------------- | ---------: |
| Frames                              |      1,639 |
| Average frame interval              |   18.31 ms |
| Worst frame interval                |   66.60 ms |
| CPU work                            |    2.91 ms |
| Frames at or above 45 FPS threshold |      90.5% |
| Frames above 33 ms                  |       9.5% |
| Result                              | Needs work |

The repeat result demonstrates that browser frame timing can vary between runs. The successful validation run above is the run used for the final passing benchmark result.

---

## 5. Measurement Method

Performance was measured directly in the browser using the Performance Lab built into the game.

The benchmark:

1. Creates the required stress workload of 5,000 enemies, 100 towers, and 1,000 projectiles.
2. Uses a warm-up period before measurement.
3. Measures browser frame intervals from `requestAnimationFrame`.
4. Separately records CPU/game-engine work time.
5. Reports the percentage of frames meeting the 45 FPS threshold and the percentage exceeding 33 ms.
6. Runs for 30 seconds for the final stress test.
7. Run the benchmark in a visible, foreground browser tab and avoid recording with DevTools Performance active during the final measurement.

The optimization experiments measure the specific operation affected by each optimization so that before-and-after changes can be compared directly.

---

## 6. Key Findings

- The initial implementation reached approximately **10–20 FPS** under the required stress workload.
- Spatial partitioning produced a **29.1% reduction** in the measured target-acquisition workload.
- Object pooling produced a **50.0% reduction** in the measured acquire/release workload.
- A successful final 30-second validation run achieved **97.8% of frames at or above the 45 FPS threshold** and only **2.2% above 33 ms**, passing the assignment criteria.

export class SpatialGrid {
  constructor(width, height, cellSize = 80) {
    this.width = width;
    this.height = height;

    this.cellSize = cellSize;

    this.cols = Math.ceil(width / cellSize);

    this.rows = Math.ceil(height / cellSize);

    this.cells = Array.from(
      {
        length: this.cols * this.rows,
      },
      () => [],
    );
  }

  clear() {
    for (let i = 0; i < this.cells.length; i += 1) {
      this.cells[i].length = 0;
    }
  }

  getCellIndex(x, y) {
    const col = Math.max(0, Math.min(this.cols - 1, Math.floor(x / this.cellSize)));

    const row = Math.max(0, Math.min(this.rows - 1, Math.floor(y / this.cellSize)));

    return row * this.cols + col;
  }

  insert(enemy) {
    const index = this.getCellIndex(enemy.x, enemy.y);

    this.cells[index].push(enemy);
  }

  queryCircle(x, y, radius, result) {
    result.length = 0;

    const minCol = Math.max(0, Math.floor((x - radius) / this.cellSize));

    const maxCol = Math.min(this.cols - 1, Math.floor((x + radius) / this.cellSize));

    const minRow = Math.max(0, Math.floor((y - radius) / this.cellSize));

    const maxRow = Math.min(this.rows - 1, Math.floor((y + radius) / this.cellSize));

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        const cell = this.cells[row * this.cols + col];

        for (let i = 0; i < cell.length; i += 1) {
          result.push(cell[i]);
        }
      }
    }

    return result;
  }
}

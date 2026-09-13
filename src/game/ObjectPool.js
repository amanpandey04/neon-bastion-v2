export class ObjectPool {
  constructor(factory, reset, initialSize = 0) {
    this.factory = factory;
    this.reset = reset;

    this.items = [];

    for (let i = 0; i < initialSize; i += 1) {
      const item = factory();

      item.active = false;

      this.items.push(item);
    }
  }

  acquire() {
    for (let i = 0; i < this.items.length; i += 1) {
      if (!this.items[i].active) {
        this.items[i].active = true;

        return this.items[i];
      }
    }

    const item = this.factory();

    item.active = true;

    this.items.push(item);

    return item;
  }

  release(item) {
    this.reset(item);
    item.active = false;
  }
}

export class ObjectPool {
  constructor(factory, reset, initialSize = 0) {
    this.factory = factory;
    this.reset = reset;

    this.items = [];
    this.freeItems = [];

    for (let i = 0; i < initialSize; i += 1) {
      const item = factory();

      item.active = false;

      this.items.push(item);
      this.freeItems.push(item);
    }
  }

  acquire() {
    let item = this.freeItems.pop();

    if (!item) {
      item = this.factory();
      this.items.push(item);
    }

    item.active = true;

    return item;
  }

  release(item) {
    if (!item?.active) {
      return;
    }

    this.reset(item);
    item.active = false;
    this.freeItems.push(item);
  }
}

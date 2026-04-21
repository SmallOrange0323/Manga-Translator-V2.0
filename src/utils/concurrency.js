/**
 * concurrency.js
 * 並發控制工具 - Semaphore（號誌）
 * 用途：限制同時執行的非同步任務數量，防止 API 過載
 */

export class Semaphore {
    /**
     * @param {number} maxConcurrency - 最大並行數（通常等於 API Key 數量）
     */
    constructor(maxConcurrency) {
        this._max = maxConcurrency;
        this._current = 0;
        this._queue = [];
    }

    /**
     * 取得一個執行許可。若已滿載，則等待直到有空位。
     * @returns {Promise<void>}
     */
    acquire() {
        return new Promise((resolve) => {
            if (this._current < this._max) {
                this._current++;
                resolve();
            } else {
                this._queue.push(resolve);
            }
        });
    }

    /**
     * 釋放一個執行許可，並喚醒下一個等待中的任務。
     */
    release() {
        this._current--;
        if (this._queue.length > 0) {
            const next = this._queue.shift();
            this._current++;
            next();
        }
    }

    /**
     * 以有序方式並行執行一組非同步工廠函數，並保留原始索引順序。
     * @param {Array<() => Promise<any>>} taskFactories - 任務工廠函數陣列
     * @returns {Promise<Array<{index: number, result?: any, error?: Error}>>}
     */
    async runAll(taskFactories) {
        const results = new Array(taskFactories.length);
        const promises = taskFactories.map((factory, index) =>
            (async () => {
                await this.acquire();
                try {
                    results[index] = { index, result: await factory() };
                } catch (err) {
                    results[index] = { index, error: err };
                } finally {
                    this.release();
                }
            })()
        );
        await Promise.all(promises);
        return results;
    }
}

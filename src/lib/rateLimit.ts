/**
 * 自動検索用のトークンバケット。
 * 音声認識が暴れてもWikipediaへ大量リクエストしないための保険。
 * ユーザーが明示的にタップした操作は bypass する（呼び出し側で allow() を呼ばない）。
 */
export class RateLimiter {
  private tokens: number;
  private last = Date.now();

  constructor(
    private readonly capacity: number,
    private readonly refillPerMinute: number,
  ) {
    this.tokens = capacity;
  }

  private refill() {
    const now = Date.now();
    const gained = ((now - this.last) / 60000) * this.refillPerMinute;
    if (gained > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + gained);
      this.last = now;
    }
  }

  /** 1リクエスト分の枠を消費できたら true */
  allow(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  get remaining(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}

/** 自動トピック検索: 1トピックあたり最大3リクエスト想定なので 12件/分 程度に絞る */
export const autoSearchLimiter = new RateLimiter(8, 12);

// Camera callbacks repeat while a label stays in frame. Keep the result
// visible until the person chooses to scan again; manual lookup remains usable.
export class ScanLock {
  private busy = false;
  private latched = false;

  begin(camera: boolean): boolean {
    if (this.busy || (camera && this.latched)) return false;
    this.busy = true;
    this.latched = true;
    return true;
  }

  finish(): void {
    this.busy = false;
  }

  reset(): void {
    if (!this.busy) this.latched = false;
  }
}

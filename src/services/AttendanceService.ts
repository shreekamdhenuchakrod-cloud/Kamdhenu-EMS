import { PunchSession } from '../types';

export class AttendanceService {
  /**
   * Helper to convert HH:mm string to minutes from midnight
   */
  static toMinutes(timeStr: string): number {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  }

  /**
   * Calculate duration in hours between two times (HH:mm format).
   * Handles midnight crossing.
   */
  static calculateHours(inTime: string, outTime: string): number {
    if (!inTime || !outTime) return 0;
    
    let inMins = this.toMinutes(inTime);
    let outMins = this.toMinutes(outTime);
    
    if (outMins < inMins) {
      outMins += 24 * 60; // crossed midnight
    }
    
    return (outMins - inMins) / 60;
  }

  /**
   * Check if a new punch overlaps with existing punch sessions.
   */
  static isOverlapping(newIn: string, newOut: string, existing: PunchSession[], ignoreIndex: number = -1): boolean {
    const newInMins = this.toMinutes(newIn);
    let newOutMins = this.toMinutes(newOut);
    if (newOutMins < newInMins) newOutMins += 24 * 60;

    for (let i = 0; i < existing.length; i++) {
      if (i === ignoreIndex) continue;
      const s = existing[i];
      if (!s.in || !s.out) continue;

      const sInMins = this.toMinutes(s.in);
      let sOutMins = this.toMinutes(s.out);
      if (sOutMins < sInMins) sOutMins += 24 * 60;

      // Overlap condition
      if (newInMins < sOutMins && newOutMins > sInMins) {
        return true;
      }
    }
    return false;
  }

  /**
   * Limits attendance requests to 2 sessions daily.
   */
  static canAddSession(existing: PunchSession[]): boolean {
    return existing.length < 2;
  }
}

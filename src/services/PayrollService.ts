import { Employee, AppDatabase } from '../types';
import { calcEmployeeFinancials, calcMonthMetrics, getHourlyRate, getRateForMonth, getDaysInMonth, MonthBreakdown, FullFinancialStatus } from '../db';

export class PayrollService {
  /**
   * Generates a monthly breakdown of all financial metrics for a specific employee.
   * Leverages existing calculations from db.ts for stability.
   */
  static getMonthMetrics(employee: Employee, year: number, month: number, db: AppDatabase): MonthBreakdown {
    return calcMonthMetrics(employee, year, month, db);
  }

  /**
   * Gets the comprehensive financial status of an employee including previous due balances.
   */
  static getFullFinancialStatus(employee: Employee, year: number, month: number, db: AppDatabase): FullFinancialStatus {
    return calcEmployeeFinancials(employee, year, month, db);
  }

  /**
   * Helper to get rate for a specific month
   */
  static getRate(employee: Employee, year: number, month: number): number {
    return getRateForMonth(employee, year, month);
  }

  /**
   * Helper to get hourly equivalent rate
   */
  static getHourlyEquivalent(employee: Employee, baseSalary: number, daysInMonth: number): number {
    return getHourlyRate(employee, baseSalary, daysInMonth);
  }
}

import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db, cleanUndefined } from '../firebase';
import { Payment, Earning, Deduction, OvertimeEntry, LateFineEntry } from '../types';

export class PayrollRepository {
  static async savePayment(payment: Payment): Promise<void> {
    const cleaned = cleanUndefined(payment);
    await setDoc(doc(db, 'payments', payment.id), cleaned, { merge: true });
  }

  static async deletePayment(id: string): Promise<void> {
    await deleteDoc(doc(db, 'payments', id));
  }

  static async saveEarning(earning: Earning): Promise<void> {
    const cleaned = cleanUndefined(earning);
    await setDoc(doc(db, 'earnings', earning.id), cleaned, { merge: true });
  }

  static async deleteEarning(id: string): Promise<void> {
    await deleteDoc(doc(db, 'earnings', id));
  }

  static async saveDeduction(deduction: Deduction): Promise<void> {
    const cleaned = cleanUndefined(deduction);
    await setDoc(doc(db, 'deductions', deduction.id), cleaned, { merge: true });
  }

  static async deleteDeduction(id: string): Promise<void> {
    await deleteDoc(doc(db, 'deductions', id));
  }

  static async saveOvertime(overtime: OvertimeEntry): Promise<void> {
    const cleaned = cleanUndefined(overtime);
    await setDoc(doc(db, 'overtimeEntries', overtime.id), cleaned, { merge: true });
  }

  static async deleteOvertime(id: string): Promise<void> {
    await deleteDoc(doc(db, 'overtimeEntries', id));
  }

  static async saveLateFine(fine: LateFineEntry): Promise<void> {
    const cleaned = cleanUndefined(fine);
    await setDoc(doc(db, 'lateFineEntries', fine.id), cleaned, { merge: true });
  }

  static async deleteLateFine(id: string): Promise<void> {
    await deleteDoc(doc(db, 'lateFineEntries', id));
  }
}

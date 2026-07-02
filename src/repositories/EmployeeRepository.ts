import { doc, getDoc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db, cleanUndefined } from '../firebase';
import { Employee } from '../types';

export class EmployeeRepository {
  static async getEmployee(id: string): Promise<Employee | null> {
    const docRef = doc(db, 'employees', id);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() as Employee;
    }
    return null;
  }

  static async saveEmployee(employee: Employee): Promise<void> {
    const cleaned = cleanUndefined(employee);
    await setDoc(doc(db, 'employees', employee.id), cleaned, { merge: true });
  }

  static async updateEmployeePin(id: string, pin: string): Promise<void> {
    const docRef = doc(db, 'employees', id);
    await updateDoc(docRef, { loginPin: pin });
  }

  static async deleteEmployee(id: string): Promise<void> {
    await deleteDoc(doc(db, 'employees', id));
  }
}

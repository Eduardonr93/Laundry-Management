
import { Injectable, signal, computed } from '@angular/core';
import { Company } from './data.service';

export type UserRole = 'admin' | 'employee';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  // Auth State
  currentUserRole = signal<UserRole>('admin');
  currentTenantId = signal<string | null>(null); // Null means not logged in
  currentCompany = signal<Company | null>(null);

  // Computed signals
  isAdmin = computed(() => this.currentUserRole() === 'admin');
  isEmployee = computed(() => this.currentUserRole() === 'employee');
  isLoggedIn = computed(() => this.currentTenantId() !== null);

  // Actions
  login(company: Company, role: UserRole): void {
    this.currentCompany.set(company);
    this.currentTenantId.set(company.id);
    this.currentUserRole.set(role);
  }

  logout(): void {
    this.currentTenantId.set(null);
    this.currentCompany.set(null);
  }

  changeRole(role: UserRole): void {
    this.currentUserRole.set(role);
  }

  updateCompanyDetails(name: string, icon: string) {
    this.currentCompany.update(c => c ? { ...c, name, icon } : null);
  }
}

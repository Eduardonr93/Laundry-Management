
import { inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map, of, throwError, delay } from 'rxjs';

// --- CONFIGURATION ---
const MOCK_API_DELAY = 400;

// --- DATA INTERFACES ---
export type Status = 'Pendiente' | 'En Proceso' | 'Listo para Entrega' | 'Entregado';
export type OrderType = 'dejar_y_recoger' | 'autolavado';
export type ServiceCategory = 'drop_off' | 'self_service';

export interface Company {
  id: string;
  name: string;
  icon: string;
  themeColor: string;
}

export interface Client {
  id: number;
  tenantId: string;
  name: string;
  phone: string;
  email: string;
  address: string;
}

export interface OrderService {
  serviceId: number;
  quantity: number;
  machineId?: number;
}

export interface Order {
  id: number;
  tenantId: string;
  clientId: number;
  orderType: OrderType;
  services: OrderService[];
  status: Status;
  total: number;
}

export interface Service {
  id: number;
  tenantId: string;
  icon: string;
  name: string;
  description: string;
  price: number;
  pricingMethod: 'per_kg' | 'per_item' | 'fixed';
  category: ServiceCategory;
  linkedMachineType?: 'washer' | 'dryer';
}

export interface Machine {
  id: number;
  tenantId: string;
  name: string;
  type: 'washer' | 'dryer';
  status: 'Disponible' | 'En Uso' | 'Mantenimiento' | 'Averiada';
  timer: number;
  isActive: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class DataService {
  private http: HttpClient;
  private apiUrl = './api/api.php';
  
  // Context for Multi-tenancy
  private currentTenantId = signal<string | null>(null);

  public useMockData = signal(true);

  // --- MOCK DATA STORE ---
  // Companies
  private mockCompanies = signal<Company[]>([
    { id: 'company_a', name: "Lavandería 'El Manantial'", icon: 'fa-water', themeColor: 'indigo' },
    { id: 'company_b', name: "LavaXpress 24/7", icon: 'fa-bolt', themeColor: 'orange' }
  ]);

   private mockClients = signal<Client[]>([
    { id: 1, tenantId: 'company_a', name: 'Ana García', phone: '555-1234', email: 'ana@test.com', address: 'Calle 1' },
    { id: 2, tenantId: 'company_a', name: 'Carlos Pérez', phone: '555-5678', email: 'carlos@test.com', address: 'Calle 2' },
    { id: 3, tenantId: 'company_b', name: 'Roberto Gómez', phone: '555-9999', email: 'roberto@test.com', address: 'Av Norte' }
   ]);

  private mockServices = signal<Service[]>([
    // Company A Services
    { id: 1, tenantId: 'company_a', icon: 'fa-weight-hanging', name: 'Lavado y Secado', description: 'Por kilo', price: 1.50, pricingMethod: 'per_kg', category: 'drop_off' },
    { id: 2, tenantId: 'company_a', icon: 'fa-shirt', name: 'Planchado', description: 'Por prenda', price: 2.50, pricingMethod: 'per_item', category: 'drop_off' },
    { id: 3, tenantId: 'company_a', icon: 'fa-coins', name: 'Ciclo Lavado', description: 'Autoservicio', price: 4.50, pricingMethod: 'fixed', category: 'self_service', linkedMachineType: 'washer' },
    { id: 4, tenantId: 'company_a', icon: 'fa-coins', name: 'Ciclo Secado', description: 'Autoservicio', price: 3.00, pricingMethod: 'fixed', category: 'self_service', linkedMachineType: 'dryer' },
    
    // Company B Services (Different prices/items)
    { id: 5, tenantId: 'company_b', icon: 'fa-jug-detergent', name: 'Lavado Premium', description: 'Incluye suavizante', price: 2.00, pricingMethod: 'per_kg', category: 'drop_off' },
    { id: 6, tenantId: 'company_b', icon: 'fa-coins', name: 'Lavadora 10kg', description: 'Ciclo completo', price: 5.00, pricingMethod: 'fixed', category: 'self_service', linkedMachineType: 'washer' },
    { id: 7, tenantId: 'company_b', icon: 'fa-coins', name: 'Secadora Industrial', description: 'Ciclo 30 min', price: 4.00, pricingMethod: 'fixed', category: 'self_service', linkedMachineType: 'dryer' },
  ]);

  private mockMachines = signal<Machine[]>([
    // Company A
    { id: 1, tenantId: 'company_a', name: 'Lavadora #1', type: 'washer', status: 'Disponible', timer: 0, isActive: true },
    { id: 2, tenantId: 'company_a', name: 'Lavadora #2', type: 'washer', status: 'En Uso', timer: 800, isActive: true },
    { id: 3, tenantId: 'company_a', name: 'Secadora #1', type: 'dryer', status: 'Disponible', timer: 0, isActive: true },
    // Company B
    { id: 4, tenantId: 'company_b', name: 'Lava-B01', type: 'washer', status: 'Disponible', timer: 0, isActive: true },
    { id: 5, tenantId: 'company_b', name: 'Seca-B01', type: 'dryer', status: 'Mantenimiento', timer: 0, isActive: true },
  ]);

  private mockOrders = signal<Order[]>([
    { id: 101, tenantId: 'company_a', clientId: 1, orderType: 'dejar_y_recoger', services: [{ serviceId: 1, quantity: 5 }], status: 'En Proceso', total: 7.50 },
    { id: 201, tenantId: 'company_b', clientId: 3, orderType: 'dejar_y_recoger', services: [{ serviceId: 5, quantity: 3 }], status: 'Pendiente', total: 6.00 }
  ]);

  constructor() {
    this.http = inject(HttpClient);
  }

  setContext(tenantId: string) {
    this.currentTenantId.set(tenantId);
  }

  getCompanies(): Observable<Company[]> {
    return of(this.mockCompanies());
  }

  updateCompany(companyId: string, name: string, icon: string): Observable<any> {
    if(this.useMockData()) {
      this.mockCompanies.update(list => list.map(c => c.id === companyId ? {...c, name, icon} : c));
      return of(true);
    }
    return of(true); // Placeholder for API
  }

  toggleDataMode(): void {
    this.useMockData.update(v => !v);
  }

  // --- API Methods (Filtered by Tenant) ---

  private get tenantId(): string {
    const id = this.currentTenantId();
    if (!id && this.useMockData()) return 'company_a'; // Fallback for safety in mock
    return id || '';
  }

  private handleError(error: HttpErrorResponse) {
    console.error('API Error:', error);
    return throwError(() => new Error('Error de servidor.'));
  }

  // --- Order Methods ---
  getOrders(): Observable<Order[]> {
    if (this.useMockData()) {
      const filtered = this.mockOrders().filter(o => o.tenantId === this.tenantId);
      return of(filtered).pipe(delay(MOCK_API_DELAY));
    }
    return this.http.get<{ data: Order[] }>(`${this.apiUrl}?action=getOrders&tenantId=${this.tenantId}`).pipe(map(res => res.data), catchError(this.handleError));
  }

  addOrder(orderData: { clientId: number; services: OrderService[], orderType: OrderType }): Observable<Order[]> {
    if (this.useMockData()) {
      const total = this._calculateTotal(orderData.services);
      const newOrder: Order = {
        id: Math.floor(Math.random() * 10000),
        tenantId: this.tenantId,
        clientId: orderData.clientId,
        services: orderData.services,
        orderType: orderData.orderType,
        status: orderData.orderType === 'autolavado' ? 'Entregado' : 'Pendiente',
        total
      };
      this.mockOrders.update(orders => [newOrder, ...orders]);
      
      const machineIds = orderData.services.map(s => s.machineId).filter((id): id is number => id !== undefined);
      if (machineIds.length > 0) {
        this.mockMachines.update(machines => machines.map(m => machineIds.includes(m.id) ? { ...m, status: 'En Uso', timer: 1800 } : m));
      }
      return this.getOrders();
    }
    return this.http.post<{ data: Order[] }>(`${this.apiUrl}?action=addOrder`, { ...orderData, tenantId: this.tenantId }).pipe(map(res => res.data), catchError(this.handleError));
  }
  
  updateOrder(orderData: any): Observable<Order[]> {
    if (this.useMockData()) {
      const newTotal = orderData.services ? this._calculateTotal(orderData.services) : 0;
      this.mockOrders.update(orders => orders.map(o => o.id === orderData.id ? { ...o, ...orderData, total: orderData.services ? newTotal : o.total } : o));
      return this.getOrders();
    }
    return this.http.post<{ data: Order[] }>(`${this.apiUrl}?action=updateOrder`, orderData).pipe(map(res => res.data), catchError(this.handleError));
  }
  
  deleteOrder(id: number): Observable<Order[]> {
    if (this.useMockData()) {
      this.mockOrders.update(orders => orders.filter(o => o.id !== id));
      return this.getOrders();
    }
    return this.http.post<{ data: Order[] }>(`${this.apiUrl}?action=deleteOrder`, { id }).pipe(map(res => res.data), catchError(this.handleError));
  }

  private _calculateTotal(services: OrderService[]): number {
    const allServices = this.mockServices().filter(s => s.tenantId === this.tenantId);
    return services.reduce((sum, os) => {
      const s = allServices.find(srv => srv.id === os.serviceId);
      return sum + (s ? s.price * os.quantity : 0);
    }, 0);
  }

  // --- Service Methods ---
  getServices(): Observable<Service[]> {
    if (this.useMockData()) {
        return of(this.mockServices().filter(s => s.tenantId === this.tenantId)).pipe(delay(MOCK_API_DELAY));
    }
    return this.http.get<{ data: Service[] }>(`${this.apiUrl}?action=getServices&tenantId=${this.tenantId}`).pipe(map(res => res.data), catchError(this.handleError));
  }
  
  addService(service: Omit<Service, 'id' | 'tenantId'>): Observable<Service> {
    if (this.useMockData()) {
      const newService = { ...service, id: Math.floor(Math.random() * 10000), tenantId: this.tenantId };
      this.mockServices.update(s => [...s, newService as Service]);
      return of(newService as Service).pipe(delay(MOCK_API_DELAY));
    }
    return this.http.post<Service>(`${this.apiUrl}?action=addService`, { ...service, tenantId: this.tenantId });
  }

  updateService(service: Service): Observable<Service> {
    if (this.useMockData()) {
      this.mockServices.update(s => s.map(i => i.id === service.id ? service : i));
      return of(service).pipe(delay(MOCK_API_DELAY));
    }
    return this.http.post<Service>(`${this.apiUrl}?action=updateService`, service);
  }
  
  deleteService(id: number): Observable<{}> {
    if (this.useMockData()) {
      this.mockServices.update(s => s.filter(i => i.id !== id));
      return of({}).pipe(delay(MOCK_API_DELAY));
    }
    return this.http.post(`${this.apiUrl}?action=deleteService`, { id });
  }

  // --- Machine Methods ---
  getMachines(): Observable<Machine[]> {
    if (this.useMockData()) return of(this.mockMachines().filter(m => m.tenantId === this.tenantId)).pipe(delay(MOCK_API_DELAY));
    return this.http.get<{ data: Machine[] }>(`${this.apiUrl}?action=getMachines&tenantId=${this.tenantId}`).pipe(map(res => res.data), catchError(this.handleError));
  }
  
  addMachine(machine: { name: string, type: 'washer' | 'dryer' }): Observable<Machine> {
    if (this.useMockData()) {
      const newMachine = { ...machine, id: Math.floor(Math.random() * 10000), tenantId: this.tenantId, status: 'Disponible' as const, timer: 0, isActive: true };
      this.mockMachines.update(m => [...m, newMachine]);
      return of(newMachine).pipe(delay(MOCK_API_DELAY));
    }
    return this.http.post<Machine>(`${this.apiUrl}?action=addMachine`, { ...machine, tenantId: this.tenantId });
  }
  
  updateMachine(machine: Machine): Observable<Machine> {
    if (this.useMockData()) {
      this.mockMachines.update(m => m.map(i => i.id === machine.id ? { ...i, ...machine } : i));
      return of(machine).pipe(delay(MOCK_API_DELAY));
    }
    return this.http.post<Machine>(`${this.apiUrl}?action=updateMachine`, machine);
  }
  
  toggleMachineStatus(id: number, isActive: boolean): Observable<{}> {
    if (this.useMockData()) {
      this.mockMachines.update(m => m.map(i => i.id === id ? { ...i, isActive, status: 'Disponible', timer: 0 } : i));
      return of({}).pipe(delay(MOCK_API_DELAY));
    }
    return this.http.post(`${this.apiUrl}?action=toggleMachineStatus`, { id, isActive });
  }

  // --- Client Methods ---
  getClients(): Observable<Client[]> {
    if (this.useMockData()) return of(this.mockClients().filter(c => c.tenantId === this.tenantId)).pipe(delay(MOCK_API_DELAY));
    return this.http.get<{ data: Client[] }>(`${this.apiUrl}?action=getClients&tenantId=${this.tenantId}`).pipe(map(res => res.data), catchError(this.handleError));
  }
  addClient(client: Omit<Client, 'id' | 'tenantId'>): Observable<Client> {
    if (this.useMockData()) {
      const newClient = { ...client, id: Math.floor(Math.random() * 10000), tenantId: this.tenantId };
      this.mockClients.update(c => [...c, newClient as Client].sort((a,b) => a.name.localeCompare(b.name)));
      return of(newClient as Client).pipe(delay(MOCK_API_DELAY));
    }
    return this.http.post<Client>(`${this.apiUrl}?action=addClient`, { ...client, tenantId: this.tenantId });
  }
  updateClient(client: Client): Observable<Client[]> {
    if (this.useMockData()) {
      this.mockClients.update(clients => clients.map(c => c.id === client.id ? client : c));
      return this.getClients();
    }
    return this.http.post<{ data: Client[] }>(`${this.apiUrl}?action=updateClient`, client).pipe(map(res => res.data));
  }
  deleteClient(id: number): Observable<Client[]> {
    if (this.useMockData()) {
      this.mockClients.update(clients => clients.filter(c => c.id !== id));
      return this.getClients();
    }
    return this.http.post<{ data: Client[] }>(`${this.apiUrl}?action=deleteClient`, { id }).pipe(map(res => res.data));
  }
}

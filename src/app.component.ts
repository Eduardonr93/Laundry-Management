
import { Component, ChangeDetectionStrategy, signal, computed, OnDestroy, OnInit, inject, effect, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService, Order, Service, Machine, Status, Client, OrderService, OrderType, Company } from './data.service';
import { AuthService, UserRole } from './auth.service';
import { finalize } from 'rxjs/operators';
import { forkJoin, of, throwError } from 'rxjs';
import { switchMap } from 'rxjs/operators';

declare var d3: any;

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule]
})
export class AppComponent implements OnInit, OnDestroy, AfterViewInit {
  public dataService = inject(DataService);
  public authService = inject(AuthService);
  private machineIntervals = new Map<number, ReturnType<typeof setInterval>>();
  
  @ViewChild('pieChartContainer') pieChartContainer!: ElementRef;
  @ViewChild('barChartContainer') barChartContainer!: ElementRef;

  // --- Login / Multi-tenant State ---
  availableCompanies = signal<Company[]>([]);
  loginForm = signal<{ companyId: string, role: UserRole }>({ companyId: '', role: 'admin' });
  isLoggedIn = this.authService.isLoggedIn;
  currentCompany = this.authService.currentCompany;

  // --- Auth State ---
  isAdmin = this.authService.isAdmin;
  currentUserRole = this.authService.currentUserRole;
  showUserMenu = signal(false);

  recentlyAddedOrderId = signal<number | null>(null);
  justFinishedMachineId = signal<number | null>(null);

  // --- App State ---
  isLoading = signal(false);
  errorMessage = signal<string | null>(null);

  orders = signal<Order[]>([]);
  services = signal<Service[]>([]);
  machines = signal<Machine[]>([]);
  clients = signal<Client[]>([]);

  showOrderModal = signal(false);
  isEditingOrder = signal(false);
  
  // Order Form State
  currentOrderForm = signal<{ id: number | null, orderType: OrderType }>({ id: null, orderType: 'dejar_y_recoger' });
  selectedClientIdInOrderForm = signal(0); // 0 = nothing selected, -1 = create new
  newClientInOrderForm = signal({ name: '', phone: '', email: '', address: '' });
  selectedServicesInOrderForm = signal<Record<number, number>>({}); 
  selectedMachinesInForm = signal<number[]>([]); 


  activeView = signal<'dashboard' | 'orders' | 'services' | 'machines' | 'clients' | 'configuracion'>('dashboard');

  showServiceModal = signal(false);
  isEditingService = signal(false);
  currentServiceForm = signal<Service>({
    id: 0, tenantId: '', name: '', icon: '', description: '', price: 0, pricingMethod: 'per_item', category: 'drop_off'
  });

  showMachineModal = signal(false);
  isEditingMachine = signal(false);
  currentMachineForm = signal<{ id: number | null, name: string, type: 'washer' | 'dryer' }>({
    id: null, name: '', type: 'washer'
  });

  showClientModal = signal(false);
  isEditingClient = signal(false);
  currentClientForm = signal<Client>({ id: 0, tenantId: '', name: '', phone: '', email: '', address: '' });

  // Config Form
  companyConfigForm = signal({ name: '', icon: '' });

  // --- Computed Signals ---
  dropOffServices = computed(() => this.services().filter(s => s.category === 'drop_off'));
  selfServiceServices = computed(() => this.services().filter(s => s.category === 'self_service'));
  otherSelfServiceItems = computed(() => this.selfServiceServices().filter(s => !s.linkedMachineType));
  availableWashers = computed(() => this.machines().filter(m => m.isActive && m.type === 'washer' && m.status === 'Disponible'));
  availableDryers = computed(() => this.machines().filter(m => m.isActive && m.type === 'dryer' && m.status === 'Disponible'));

  computedTotalInOrderForm = computed(() => {
    const allServices = this.services();
    let total = 0;

    const machineServices = this.selectedMachinesInForm().map(machineId => {
        const machine = this.machines().find(m => m.id === machineId);
        return allServices.find(s => s.linkedMachineType === machine?.type);
    });
    machineServices.forEach(service => {
        if(service) total += service.price;
    });

    const otherItems = this.selectedServicesInOrderForm();
    Object.entries(otherItems).forEach(([serviceId, quantity]) => {
        const service = allServices.find(s => s.id === Number(serviceId));
        if (service) total += service.price * Number(quantity);
    });
    
    return total;
  });

  dashboardStats = computed(() => {
    const orders = this.orders();
    const machines = this.machines();
    const totalRevenue = orders
      .filter(o => o.status === 'Entregado')
      .reduce((sum, o) => sum + o.total, 0);
    const activeOrders = orders.filter(o => o.status === 'En Proceso').length;
    const pendingOrders = orders.filter(o => o.status === 'Pendiente').length;
    const availableMachines = machines.filter(m => m.status === 'Disponible' && m.isActive).length;

    return { totalRevenue, activeOrders, pendingOrders, availableMachines };
  });

  ordersByStatus = computed(() => {
      const counts = this.orders().reduce((acc, order) => {
          acc[order.status] = (acc[order.status] || 0) + 1;
          return acc;
      }, {} as Record<Status, number>);
      
      return Object.entries(counts).map(([status, count]) => ({ status, count }));
  });

  ordersByClient = computed(() => {
    const clientMap = this.clients().reduce((acc, client) => {
      acc[client.id] = client.name;
      return acc;
    }, {} as Record<number, string>);

    const counts = this.orders().reduce((acc, order) => {
        const clientName = clientMap[order.clientId] || 'Cliente Desconocido';
        acc[clientName] = (acc[clientName] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    return Object.entries(counts)
      .map(([clientName, count]) => ({ clientName, count }))
      .sort((a, b) => Number(b.count) - Number(a.count))
      .slice(0, 10);
  });

  constructor() {
    effect(() => {
      if (this.isLoggedIn() && this.activeView() === 'dashboard' && this.pieChartContainer && this.ordersByStatus().length > 0) { this.drawPieChart(); }
      if (this.isLoggedIn() && this.activeView() === 'dashboard' && this.barChartContainer && this.ordersByClient().length > 0) { this.drawBarChart(); }
    });

    effect(() => {
      if (this.isLoggedIn()) {
          const view = this.activeView();
          if (!this.isAdmin() && (view === 'configuracion' || view === 'services')) {
            this.setView('dashboard');
          }
      }
    });

    effect(() => {
        // Sync config form with current company
        const c = this.currentCompany();
        if(c) {
            this.companyConfigForm.set({ name: c.name, icon: c.icon });
        }
    });
  }

  ngOnInit() { 
    // Fetch companies for login screen
    this.dataService.getCompanies().subscribe(companies => {
        this.availableCompanies.set(companies);
        if (companies.length > 0) {
            this.loginForm.update(f => ({ ...f, companyId: companies[0].id }));
        }
    });
  }

  ngAfterViewInit() {
    // Chart logic handled by effect
  }

  // --- Login Helpers ---
  selectCompany(companyId: string) {
    this.loginForm.update(f => ({ ...f, companyId }));
  }

  selectRole(role: UserRole) {
    this.loginForm.update(f => ({ ...f, role }));
  }

  // --- Login Logic ---
  performLogin(): void {
    const { companyId, role } = this.loginForm();
    const company = this.availableCompanies().find(c => c.id === companyId);
    if (company) {
        this.dataService.setContext(company.id);
        this.authService.login(company, role);
        this.loadAppData();
    }
  }

  performLogout(): void {
      this.authService.logout();
      this.orders.set([]);
      this.services.set([]);
      this.machines.set([]);
      this.clients.set([]);
      this.activeView.set('dashboard');
  }

  loadAppData(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    forkJoin({
      services: this.dataService.getServices(),
      machines: this.dataService.getMachines(),
      orders: this.dataService.getOrders(),
      clients: this.dataService.getClients()
    }).pipe(
      finalize(() => this.isLoading.set(false))
    ).subscribe({
      next: ({ services, machines, orders, clients }) => {
        this.services.set(services);
        this.machines.set(machines);
        this.orders.set(orders);
        this.clients.set(clients);
        this.updateMachineIntervals();
      },
      error: err => { this.errorMessage.set(err.message); }
    });
  }

  updateMachineIntervals(): void {
    this.machineIntervals.forEach(interval => clearInterval(interval));
    this.machineIntervals.clear();
    this.machines().forEach(machine => {
      if (machine.status === 'En Uso' && machine.timer > 0) {
        this.startMachineInterval(machine);
      }
    });
  }

  ngOnDestroy() { this.machineIntervals.forEach(intervalId => clearInterval(intervalId)); }
  
  changeRole(role: UserRole) {
    this.authService.changeRole(role);
    this.setView('dashboard');
    this.showUserMenu.set(false);
  }

  orderModalTitle = computed(() => this.isEditingOrder() ? 'Editar Pedido' : 'Nuevo Pedido');
  serviceModalTitle = computed(() => this.isEditingService() ? 'Editar Servicio' : 'Nuevo Servicio');
  machineModalTitle = computed(() => this.isEditingMachine() ? 'Editar Máquina' : 'Nueva Máquina');
  clientModalTitle = computed(() => this.isEditingClient() ? 'Editar Cliente' : 'Nuevo Cliente');
  
  displayOrders = computed(() => this.orders());
  activeMachines = computed(() => this.machines().filter(m => m.isActive));

  setView(view: 'dashboard' |'orders' | 'services' | 'machines' | 'clients' | 'configuracion'): void {
    this.activeView.set(view);
  }

  setOrderTypeInModal(type: OrderType): void {
    if (this.isEditingOrder()) return;
    this.currentOrderForm.update(form => ({...form, orderType: type}));
    this.selectedServicesInOrderForm.set({});
    this.selectedMachinesInForm.set([]);
  }

  openNewOrderModal(): void {
    this.isEditingOrder.set(false);
    this.currentOrderForm.set({ id: null, orderType: 'dejar_y_recoger' });
    this.selectedClientIdInOrderForm.set(0); 
    this.newClientInOrderForm.set({ name: '', phone: '', email: '', address: '' });
    this.selectedServicesInOrderForm.set({});
    this.selectedMachinesInForm.set([]);
    this.showOrderModal.set(true);
  }

  openEditOrderModal(order: Order): void {
    this.isEditingOrder.set(true);
    this.currentOrderForm.set({ id: order.id, orderType: order.orderType });
    this.selectedClientIdInOrderForm.set(order.clientId);
    const selectedServices = order.services.reduce((acc, s) => {
      if (!s.machineId) acc[s.serviceId] = s.quantity;
      return acc;
    }, {} as Record<number, number>);
    const selectedMachines = order.services.filter(s => s.machineId).map(s => s.machineId!);
    this.selectedServicesInOrderForm.set(selectedServices);
    this.selectedMachinesInForm.set(selectedMachines);
    this.showOrderModal.set(true);
  }

  closeOrderModal(): void {
    this.showOrderModal.set(false);
  }
  
  toggleServiceSelection(serviceId: number) {
    this.selectedServicesInOrderForm.update(current => {
      const updated = { ...current };
      if (updated[serviceId]) {
        delete updated[serviceId];
      } else {
        updated[serviceId] = 1;
      }
      return updated;
    });
  }

  toggleMachineSelection(machineId: number): void {
    if(this.isEditingOrder()) return;
    this.selectedMachinesInForm.update(current => {
        if(current.includes(machineId)) {
            return current.filter(id => id !== machineId);
        } else {
            return [...current, machineId];
        }
    });
  }

  updateServiceQuantity(serviceId: number, event: Event): void {
    const quantity = Number((event.target as HTMLInputElement).value);
    if (quantity >= 0) {
        this.selectedServicesInOrderForm.update(current => ({
            ...current,
            [serviceId]: quantity
        }));
    }
  }

  onClientSelectionChange(value: any): void {
    this.selectedClientIdInOrderForm.set(Number(value));
  }

  saveOrder(): void {
    const selectedClientId = this.selectedClientIdInOrderForm();
    let serviceItems: OrderService[] = [];

    if (this.currentOrderForm().orderType === 'autolavado') {
        this.selectedMachinesInForm().forEach(machineId => {
            const machine = this.machines().find(m => m.id === machineId);
            const service = this.services().find(s => s.linkedMachineType === machine?.type);
            if (service) {
                serviceItems.push({ serviceId: service.id, quantity: 1, machineId: machineId });
            }
        });
        Object.entries(this.selectedServicesInOrderForm()).forEach(([serviceId, quantity]) => {
            if (Number(quantity) > 0) {
              serviceItems.push({ serviceId: Number(serviceId), quantity: Number(quantity) });
            }
        });
    } else { 
        serviceItems = Object.entries(this.selectedServicesInOrderForm())
          .filter(([, quantity]) => Number(quantity) > 0)
          .map(([serviceId, quantity]) => ({
            serviceId: Number(serviceId),
            quantity: Number(quantity)
          }));
    }

    if (serviceItems.length === 0) return;
    
    const client$ = selectedClientId === -1 
      ? this.dataService.addClient(this.newClientInOrderForm())
      : of(this.clients().find(c => c.id === selectedClientId));

    client$.pipe(
      switchMap(client => {
        if (!client) return throwError(() => new Error('Cliente no válido'));
        
        if(selectedClientId === -1) {
          this.clients.update(list => [...list, client].sort((a,b) => a.name.localeCompare(b.name)));
        }

        if (this.isEditingOrder()) {
          const currentOrder = this.orders().find(o => o.id === this.currentOrderForm().id)!;
          const orderData = { id: currentOrder.id, tenantId: currentOrder.tenantId, clientId: client.id, services: serviceItems, status: currentOrder.status, orderType: this.currentOrderForm().orderType };
          return this.dataService.updateOrder(orderData);
        } else {
          const orderData = { clientId: client.id, services: serviceItems, orderType: this.currentOrderForm().orderType };
          return this.dataService.addOrder(orderData);
        }
      }),
      switchMap(updatedOrders => {
        this.orders.set(updatedOrders);
        if (this.currentOrderForm().orderType === 'autolavado' && !this.isEditingOrder()) {
          return this.dataService.getMachines(); 
        }
        return of(null);
      })
    ).subscribe(updatedMachines => {
      if (updatedMachines) {
        this.machines.set(updatedMachines);
        this.updateMachineIntervals();
      }

      if (!this.isEditingOrder()) {
          const newOrderId = this.orders()[0]?.id;
          if (newOrderId) {
            this.recentlyAddedOrderId.set(newOrderId);
            setTimeout(() => this.recentlyAddedOrderId.set(null), 2000);
          }
      }
      this.closeOrderModal();
    });
  }

  deleteOrder(idToDelete: number): void {
    if (confirm('¿Estás seguro de que quieres eliminar este pedido?')) {
        this.dataService.deleteOrder(idToDelete).subscribe(updatedOrders => {
            this.orders.set(updatedOrders);
        });
    }
  }

  cycleStatus(order: Order): void {
    const statuses: Status[] = ['Pendiente', 'En Proceso', 'Listo para Entrega', 'Entregado'];
    const currentIndex = statuses.indexOf(order.status);
    const nextIndex = (currentIndex + 1) % statuses.length;
    const newStatus = statuses[nextIndex];
    this.dataService.updateOrder({ ...order, status: newStatus }).subscribe(updatedOrders => {
        this.orders.set(updatedOrders);
    });
  }

  // --- Client Methods ---
  openNewClientModal(): void {
    this.isEditingClient.set(false);
    this.currentClientForm.set({ id: 0, tenantId: '', name: '', phone: '', email: '', address: '' });
    this.showClientModal.set(true);
  }
  openEditClientModal(client: Client): void {
    this.isEditingClient.set(true);
    this.currentClientForm.set({ ...client });
    this.showClientModal.set(true);
  }
  closeClientModal(): void { this.showClientModal.set(false); }
  saveClient(): void {
    const formData = this.currentClientForm();
    if (!formData.name || !formData.phone) return;
    const op = this.isEditingClient() ? this.dataService.updateClient(formData) : this.dataService.addClient(formData).pipe(switchMap(() => this.dataService.getClients()));
    op.subscribe(updatedClients => { this.clients.set(updatedClients); this.closeClientModal(); });
  }
  deleteClient(clientId: number): void {
    if (confirm('¿Estás seguro?')) {
      this.dataService.deleteClient(clientId).subscribe(updatedClients => { this.clients.set(updatedClients); });
    }
  }
  
  // --- Machine Methods ---
  private startMachineInterval(machine: Machine) {
    this.stopMachineAndClearInterval(machine);
    const intervalId = setInterval(() => {
        this.machines.update(machines => 
            machines.map(m => {
                if (m.id === machine.id) {
                    const newTimer = m.timer - 1;
                    if (newTimer < 0) {
                        this.stopMachineAndClearInterval(m);
                        this.justFinishedMachineId.set(m.id);
                        this.playNotificationSound();
                        setTimeout(() => this.justFinishedMachineId.set(null), 3000);
                        return { ...m, status: 'Disponible', timer: 0 };
                    }
                    return { ...m, timer: newTimer };
                }
                return m;
            })
        );
    }, 1000);
    this.machineIntervals.set(machine.id, intervalId);
  }
  startCycle(m: Machine): void { this.machines.update(ms => ms.map(i => i.id === m.id ? { ...i, status: 'En Uso', timer: 1800 } : i)); const u = this.machines().find(i => i.id === m.id); if (u) this.startMachineInterval(u); }
  stopCycle(m: Machine): void { this.stopMachineAndClearInterval(m); this.machines.update(ms => ms.map(i => i.id === m.id ? { ...i, status: 'Disponible', timer: 0 } : i)); }
  setForMaintenance(m: Machine): void { this.stopMachineAndClearInterval(m); this.machines.update(ms => ms.map(i => i.id === m.id ? { ...i, status: 'Mantenimiento', timer: 0 } : i)); }
  reportAsBroken(m: Machine): void { this.stopMachineAndClearInterval(m); this.machines.update(ms => ms.map(i => i.id === m.id ? { ...i, status: 'Averiada', timer: 0 } : i)); }
  resolveMachine(m: Machine): void { this.machines.update(ms => ms.map(i => i.id === m.id ? { ...i, status: 'Disponible', timer: 0 } : i)); }

  // --- UI Helpers ---
  getClientName(id: number): string { return this.clients().find(c => c.id === id)?.name || 'N/A'; }
  
  getServiceDetailsForDisplay(orderServices: OrderService[]): string {
    const allServices = this.services();
    const allMachines = this.machines();
    if (!orderServices) return '';
    return orderServices.map(os => {
      const service = allServices.find(s => s.id === os.serviceId);
      if (!service) return 'Servicio Desconocido';
      
      if (os.machineId) {
        const machine = allMachines.find(m => m.id === os.machineId);
        return machine ? `${service.name} (${machine.name})` : service.name;
      }

      switch(service.pricingMethod) {
        case 'per_kg': 
          return `${service.name} (${os.quantity}kg)`;
        case 'per_item': 
          return `${service.name} (${os.quantity} ${os.quantity === 1 ? 'prenda' : 'prendas'})`;
        case 'fixed': 
          return service.name + (os.quantity > 1 ? ` (x${os.quantity})` : '');
        default:
          return service.name;
      }
    }).join(', ');
  }

  getUnitLabel(method: Service['pricingMethod']): string {
    switch (method) {
      case 'per_kg': return '/ kg';
      case 'per_item': return '/ prenda';
      default: return '';
    }
  }

  getQuantityLabel(method: Service['pricingMethod']): string {
    switch (method) {
      case 'per_kg': return 'Kg:';
      case 'per_item': return 'Cantidad:';
      default: return 'Unidades:';
    }
  }

  getStatusClasses(s: Status): string { switch (s) { case 'Pendiente': return 'bg-yellow-100 text-yellow-800'; case 'En Proceso': return 'bg-blue-100 text-blue-800'; case 'Listo para Entrega': return 'bg-green-100 text-green-800'; case 'Entregado': return 'bg-gray-100 text-gray-800'; default: return 'bg-gray-100 text-gray-800'; } }
  private playNotificationSound(): void { (document.getElementById('notificationSound') as HTMLAudioElement)?.play().catch(console.error); }
  private stopMachineAndClearInterval(m: Machine) { if (this.machineIntervals.has(m.id)) { clearInterval(this.machineIntervals.get(m.id)!); this.machineIntervals.delete(m.id); } }
  getMachineStatusClasses(s: Machine['status']) { switch (s) { case 'Disponible': return { border: 'border-green-500', bg: 'bg-green-50', text: 'text-green-800', badge: 'bg-green-100 text-green-800', iconBg: 'bg-green-100', iconText: 'text-green-600' }; case 'En Uso': return { border: 'border-blue-500', bg: 'bg-blue-50', text: 'text-blue-800', badge: 'bg-blue-100 text-blue-800', iconBg: 'bg-blue-100', iconText: 'text-blue-600' }; case 'Mantenimiento': return { border: 'border-amber-500', bg: 'bg-amber-50', text: 'text-amber-800', badge: 'bg-amber-100 text-amber-800', iconBg: 'bg-amber-100', iconText: 'text-amber-600' }; case 'Averiada': return { border: 'border-red-600', bg: 'bg-red-50', text: 'text-red-800', badge: 'bg-red-100 text-red-800', iconBg: 'bg-red-100', iconText: 'text-red-600' }; } }
  formatTime(s: number): string { const m = Math.floor(s / 60); const sec = s % 60; return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`; }

  // --- Admin-only Service & Machine Methods ---
  openNewServiceModal(): void { this.isEditingService.set(false); this.currentServiceForm.set({ id: 0, tenantId: '', name: '', icon: 'fa-shirt', description: '', price: 0, pricingMethod: 'per_item', category: 'drop_off' }); this.showServiceModal.set(true); }
  openEditServiceModal(s: Service): void { this.isEditingService.set(true); this.currentServiceForm.set({ ...s }); this.showServiceModal.set(true); }
  closeServiceModal(): void { this.showServiceModal.set(false); }
  saveService(): void {
    const d = this.currentServiceForm();
    if (!d.name || !d.description || Number(d.price) <= 0) {
      return;
    }
    const o = this.isEditingService() ? this.dataService.updateService(d) : this.dataService.addService(d);
    o.subscribe(() => {
      this.dataService.getServices().subscribe(s => this.services.set(s));
      this.closeServiceModal();
    });
  }
  deleteService(id: number): void { if (confirm(`¿Estás seguro?`)) { this.dataService.deleteService(id).subscribe(() => { this.services.update(s => s.filter(i => i.id !== id)); }); } }
  openNewMachineModal(): void { this.isEditingMachine.set(false); this.currentMachineForm.set({ id: null, name: '', type: 'washer' }); this.showMachineModal.set(true); }
  openEditMachineModal(m: Machine): void { this.isEditingMachine.set(true); this.currentMachineForm.set({ id: m.id, name: m.name, type: m.type }); this.showMachineModal.set(true); }
  closeMachineModal(): void { this.showMachineModal.set(false); }
  saveMachine(): void { const d = this.currentMachineForm(); if (!d.name) return; const o = this.isEditingMachine() ? this.dataService.updateMachine(d as any) : this.dataService.addMachine(d as any); o.subscribe(() => { this.dataService.getMachines().subscribe(m => this.machines.set(m)); this.closeMachineModal(); }); }
  deactivateMachine(m: Machine): void { if (confirm(`¿Desactivar "${m.name}"?`)) { this.stopMachineAndClearInterval(m); this.dataService.toggleMachineStatus(m.id, false).subscribe(() => { this.machines.update(ms => ms.map(i => i.id === m.id ? { ...i, isActive: false, status: 'Disponible', timer: 0 } : i)); }); } }
  reactivateMachine(m: Machine): void { this.dataService.toggleMachineStatus(m.id, true).subscribe(() => { this.machines.update(ms => ms.map(i => i.id === m.id ? { ...i, isActive: true } : i)); }); }

  toggleDataMode(): void {
    this.dataService.toggleDataMode();
    this.loadAppData();
  }

  saveCompanyConfig(): void {
    const c = this.currentCompany();
    if(c && this.companyConfigForm().name) {
        const { name, icon } = this.companyConfigForm();
        this.dataService.updateCompany(c.id, name, icon).subscribe(() => {
            this.authService.updateCompanyDetails(name, icon);
            alert('Configuración actualizada');
        });
    }
  }

  // --- D3 Chart Drawing Methods ---
  private drawPieChart(): void { if (!this.pieChartContainer) return; const e = this.pieChartContainer.nativeElement; d3.select(e).select('svg').remove(); const d = this.ordersByStatus(); if (d.length === 0) return; const w = e.offsetWidth, h = 300, m = 40, r = Math.min(w, h) / 2 - m; const s = d3.select(e).append('svg').attr('width', w).attr('height', h).append('g').attr('transform', `translate(${w / 2}, ${h / 2})`); const c = d3.scaleOrdinal().domain(d.map(i => i.status)).range(['#facc15', '#3b82f6', '#22c55e', '#6b7280']); const p = d3.pie().value((i: any) => i.count); const dr = p(d); const a = d3.arc().innerRadius(r * 0.5).outerRadius(r * 0.8); s.selectAll('path').data(dr).enter().append('path').attr('d', a).attr('fill', (i: any) => c(i.data.status)).attr('stroke', 'white').style('stroke-width', '2px').style('opacity', 0.7).transition().duration(1000).attrTween('d', function(i: any) { const j = d3.interpolate(i.startAngle, i.endAngle); return function(t: any) { i.endAngle = j(t); return a(i); } }); }
  private drawBarChart(): void { if (!this.barChartContainer) return; const e = this.barChartContainer.nativeElement; d3.select(e).select('svg').remove(); const d = this.ordersByClient(); if (d.length === 0) return; const m = { top: 20, right: 30, bottom: 80, left: 40 }; const w = e.offsetWidth - m.left - m.right; const h = 300 - m.top - m.bottom; const s = d3.select(e).append("svg").attr("width", w + m.left + m.right).attr("height", h + m.top + m.bottom).append("g").attr("transform", `translate(${m.left},${m.top})`); const x = d3.scaleBand().range([0, w]).domain(d.map(i => i.clientName)).padding(0.2); s.append("g").attr("transform", `translate(0, ${h})`).call(d3.axisBottom(x)).selectAll("text").attr("transform", "translate(-10,0)rotate(-45)").style("text-anchor", "end"); const y = d3.scaleLinear().domain([0, d3.max(d, (i: any) => i.count)]).range([h, 0]); s.append("g").call(d3.axisLeft(y)); s.selectAll("rect").data(d).enter().append("rect").attr("x", (i: any) => x(i.clientName)).attr("y", h).attr("width", x.bandwidth()).attr("height", 0).attr("fill", "#4f46e5").transition().duration(800).attr("y", (i: any) => y(i.count)).attr("height", (i: any) => h - y(i.count)).delay((i: any,j: number) => j*100); }
}



import { bootstrapApplication } from '@angular/platform-browser';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';

import { AppComponent } from './src/app.component';
import { AuthService } from './src/auth.service';

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    provideHttpClient(),
    AuthService
  ]
}).catch(err => console.error(err));

// AI Studio always uses an `index.tsx` file for all project types.

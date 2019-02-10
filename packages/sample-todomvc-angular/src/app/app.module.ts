import {BrowserModule} from '@angular/platform-browser';
import {NgModule} from '@angular/core';

import {AppComponent} from './app.component';
import {FormsModule} from '@angular/forms';
import {TodoStore} from './services/store';

@NgModule({
    declarations: [
        AppComponent
    ],
    imports: [
        BrowserModule,
        FormsModule,
    ],
    providers: [
        TodoStore
    ],
    bootstrap: [AppComponent]
})
export class AppModule {
}

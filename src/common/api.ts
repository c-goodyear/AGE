import {Injectable} from '@angular/core';
import {HttpClient, HttpHeaders} from '@angular/common/http';
import {Observable} from 'rxjs';
import {environment} from '../environments/environment';
import {LogglyService} from '../loggly/loggly.service';
import {GeneralConfiguration, Wcif} from './classes';
import {ActivityHelper} from './activity';

@Injectable({
  providedIn: 'root'
})
export class ApiService {

  private readonly FOUR_WEEKS = 28;

  public oauthToken;
  private headerParams: HttpHeaders;
  private logglyService: LogglyService;

  constructor(private httpClient: HttpClient) {
    this.getToken();

    this.headerParams = new HttpHeaders();
    this.headerParams = this.headerParams.set('Authorization', `Bearer ${this.oauthToken}`);
    this.headerParams = this.headerParams.set('Content-Type', 'application/json');

    this.initLoggly();
  }

  private initLoggly() {
    this.logglyService = new LogglyService(this.httpClient);
    this.logglyService.push({
      logglyKey: '3c4e81e2-b2ae-40e3-88b5-ba8e8b810586',
      sendConsoleErrors: false,
      tag: 'AGE'
    });
  }

  private getToken(): void {
    if (environment.offlineMode) {
      this.oauthToken = 'offline';
      return;
    }

    const hash = window.location.hash.slice(1, window.location.hash.length - 1);
    const hashParams = new URLSearchParams(hash);
    if (hashParams.has('access_token')) {
      this.oauthToken = hashParams.get('access_token');
    }
  }

  logIn(): void {
    window.location.href = `${environment.wcaUrl}/oauth/authorize?client_id=${environment.wcaAppId}&redirect_uri=${environment.appUrl}&response_type=token&scope=public manage_competitions`;
  }

  getUser(): Observable<any> {
    const url = `${environment.wcaUrl}/api/v0/me`;
    return this.httpClient.get(url, {headers: this.headerParams});
  }

  getCompetitions(): Observable<any> {
    let url = `${environment.wcaUrl}/api/v0/competitions?managed_by_me=true`;
    if (!environment.testMode) {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - this.FOUR_WEEKS);
      url += `&start=${startDate.toISOString()}`;
    }
    return this.httpClient.get(url, {headers: this.headerParams});
  }

  getWcif(competitionId): Observable<any> {
    // if (environment.testMode) {
    //   return of(AustralianNationalsWcif.wcif);
    // }
    return this.httpClient.get(`${environment.wcaUrl}/api/v0/competitions/${competitionId}/wcif`,
      {headers: this.headerParams});
  }

  patchWcif(wcif: Wcif, configuration: GeneralConfiguration, successCallback: () => void, errorCallback: (error) => void) {
    this.addAgeExtension(wcif);
    ActivityHelper.addChildActivitiesForEveryRound(wcif);

    ActivityHelper.createAssignmentsInWcif(wcif, configuration);

    const persons = wcif.persons.map(p => ({
      assignments: p.assignments,
      name: p.name,
      registrantId: p.registrantId,
      wcaId: p.wcaId,
      wcaUserId: p.wcaUserId,
    }));
    const wcifToSend = {
      id: wcif.id,
      schedule: wcif.schedule,
      persons: persons,
    };

    this.patch(wcifToSend, errorCallback, successCallback);
  }

  private patch(wcif: any, errorCallback: (error) => void, successCallback: () => void) {
    this.httpClient.patch(
      `${environment.wcaUrl}/api/v0/competitions/${wcif.id}/wcif`,
      JSON.stringify(wcif),
      {headers: this.headerParams})
      .subscribe(null, (error) => errorCallback(error), () => successCallback());
  }

  doesNotContainAGEExtension(wcif): boolean {
    return wcif.extensions.filter(e => e.id === 'AGE').length === 0;
  }

  private addAgeExtension(wcif: Wcif) {
    if (this.doesNotContainAGEExtension(wcif)) {
      wcif.extensions.push(
        {
          'id': 'AGE',
          'specUrl': 'https://github.com/Goosly/AGE',
          'data': {}
        });
    }
  }

  logUserLoggedIn(user) {
    this.logMessage(user.me.name + ' (' + user.me.wca_id + ') has logged in into AGE');
  }

  logUserFetchedWcifOf(userNameShort: string, competitionId: string) {
    this.logMessage(userNameShort + ' fetched the Wcif of ' + competitionId);
  }

  logUserImportedFromWcif(userNameShort: string, competitionId: any) {
    this.logMessage(userNameShort + ' imported assignments from Wcif for ' + competitionId);
  }

  logUserImportedFromCsv(userNameShort: string, competitionId: any) {
    this.logMessage(userNameShort + ' imported from CSV for ' + competitionId);
  }

  logUserClicksExport(userNameShort: string, competitionId: any) {
    this.logMessage(userNameShort + ' clicks export for ' + competitionId);
  }

  logUserSavedFromWcif(userNameShort: string, competitionId: any) {
    this.logMessage(userNameShort + ' saved the Wcif of ' + competitionId);
  }

  logUserGotErrorFromSavingWcif(userNameShort: string, competitionId: any, error: string) {
    this.logMessage(userNameShort + ' got an error saving the wcif of ' + competitionId + ': ' + error);
  }

  logUserClicksBackToEdit(userNameShort: string, competitionId: any) {
    this.logMessage(userNameShort + ' goes back to editing for ' + competitionId);
  }

  private logMessage(message: string) {
    if (!environment.testMode) {
      setTimeout(() => {
        try {
          this.logglyService.push(message);
        } catch (e) {
          console.error(e);
        }
      }, 0);
    }
  }
}

import {Injectable} from '@angular/core';
import {Assignment, EventConfiguration, GeneralConfiguration, StaffPerson, Wcif} from './classes';
import {Helpers} from './helpers';
import {Activity, AssignmentCode, EventId, Person} from '@wca/helpers';
import {ActivityHelper} from './activity';
import {parseActivityCode} from '@wca/helpers/lib/helpers/activity';

@Injectable({
  providedIn: 'root'
})
export class GroupService {
  wcif: Wcif;
  configuration: GeneralConfiguration = new GeneralConfiguration();
  userWcaId: string;
  document: Document;

  constructor() {}

  generateGrouping(eventId: EventId) {
    if (Helpers.getEvent(eventId, this.wcif).configuration.skip) {
      return;
    }

    if (this.configuration.groupStrategy === 'basic') {
      this.generateBasicGrouping(eventId);
    } else if (this.configuration.groupStrategy === 'basicBySpeed') {
      this.generateBasicBySpeedGrouping(eventId, false);
    } else if (this.configuration.groupStrategy === 'basicBySpeedReverse') {
      this.generateBasicBySpeedGrouping(eventId, true);
    } else if (this.configuration.groupStrategy === 'advanced') {
      this.generateAdvancedGrouping(eventId, this.getStaffFile());
    }
  }

  generateAdvancedGrouping(eventId: EventId, file: Blob) {
    const generateGroupingForEvent = (e, s) => this.generateGroupingForEvent(e, s);
    if (file) {
      const reader = new FileReader();
      reader.readAsText(file);
      reader.onload = function(e) {
        const staff: StaffPerson[] = this.getStaff(e.target['result']);
        generateGroupingForEvent(eventId, staff);
      }.bind(this);
    } else if (this.configuration.autoPickScramblersAndRunners) {
      generateGroupingForEvent(eventId, Helpers.generateStaffBasedOnPersonalBests(this.wcif));
    } else {
      throw new Error('There are no scramblers and runners! Please select a CSV file or let AGE pick scramblers and runners');
    }
  }

  public getStaff(csvString): StaffPerson[] {
    const lines: string[] = csvString.includes('\r\n') ? csvString.split('\r\n') : csvString.split('\n');
    const separator = this.determineSeparator(csvString);
    const headers = lines[0].split(separator);
    this.validateHeaders(headers);
    const persons = lines.splice(1);

    const staff: StaffPerson[] = [];
    for (let i = 0; i < persons.length; i++) {
      if (persons[i] === null || persons[i] === undefined || persons[i] === '' || !persons[i].includes(separator)) {
        continue;
      }
      const personToAdd = persons[i].split(separator);
      const staffPerson: StaffPerson = new StaffPerson();
      staffPerson.name = personToAdd[headers.indexOf('name')];
      staffPerson.wcaId = personToAdd[headers.indexOf('wcaId')];
      staffPerson.isAllowedTo = [];
      ['run', '222', '333', '444', '555', '666', '777', '333bf', '333oh', 'clock', 'minx', 'pyram', 'skewb', 'sq1', '444bf', '555bf', '333mbf'].forEach(task => {
        if (!!personToAdd[headers.indexOf(task)]) {
          staffPerson.isAllowedTo.push(task);
        }
      });
      staff.push(staffPerson);
    }
    return staff;
  }

  private validateHeaders(headers: string[]) {
    const expectedHeaders: string[] = ['name', 'wcaId', 'run', '222', '333', '444', '555', '666', '777', '333bf', '333oh', 'clock', 'minx', 'pyram', 'skewb', 'sq1', '444bf', '555bf', '333mbf'];
    expectedHeaders.forEach(expectedHeader => {
      if (!headers.includes(expectedHeader)) {
        const error: string = 'Expected header ' + expectedHeader + ' in the selected csv file, but it was not present.';
        alert(error);
        throw new Error(error);
      }
    });
  }

  private generateBasicGrouping(eventId: EventId) { // Very simple: random groups
    const event: any = Helpers.getEvent(eventId, this.wcif);
    const eventConfiguration: EventConfiguration = event.configuration;
    let i = 0;
    this.shuffleCompetitors();
    const competitors = this.wcif.persons.filter(p => p[eventId].competing);
    this.moveTopCompetitorsToPositionsForLastGroup(competitors, event);
    competitors.forEach(p => {
      p[eventId].group = (i + 1) + '';
      i = (i + 1) % eventConfiguration.scrambleGroups;
    });
    this.countCJRSForEvent(eventId);
    Helpers.sortCompetitorsByName(this.wcif);
  }

  private generateBasicBySpeedGrouping(eventId: EventId, reverse: boolean) { // Sort by speed, then loop and assign group 1 to first chunk, then group 2, etc.
    const event: any = Helpers.getEvent(eventId, this.wcif);
    const eventConfiguration: EventConfiguration = event.configuration;
    const sizeOfGroup = this.wcif.persons.filter(p => p[eventId].competing).length / eventConfiguration.scrambleGroups;
    Helpers.sortCompetitorsBySpeedInEvent(this.wcif, eventId, reverse);
    this.wcif.persons.filter(p => p[eventId].competing).forEach((p, index) => {
      p[eventId].group = (Math.trunc(index / sizeOfGroup) + 1) + '';
    });
    this.countCJRSForEvent(eventId);
    Helpers.sortCompetitorsByName(this.wcif);
  }

  private generateGroupingForEvent(eventId: EventId, staff: StaffPerson[]) {
    // Make some variables
    const event: any = Helpers.getEvent(eventId, this.wcif);
    const taskCounter = this.createTaskCounter(event.configuration); // Variable to keep track of assignments for all groups

    this.markPersonsThatArePartOfTheStaff(staff);

    this.shuffleCompetitors();
    // Determine competitors and which of them can scramble, run and/or judge
    let allCompetitors: Array<any> = this.wcif.persons.filter(p => p[eventId].competing);
    let potentialScramblers: Array<any> = this.wcif.persons.filter(p => p[eventId].competing && this.canScramble(p, staff, eventId));
    let potentialRunners: Array<any> = this.wcif.persons.filter(p => p[eventId].competing && this.canRun(p, staff));

    if (potentialScramblers.length < this.numberOfGroups(event) * event.configuration.scramblers) {
      alert('Not enough scramblers for ' + eventId + '!\nPlease double check and manually assign more scramblers');
    }
    if (potentialRunners.length < this.numberOfGroups(event) * event.configuration.runners) {
      alert('Not enough runners for ' + eventId + '!\nPlease double check and manually assign more runners');
    }

    let group = 0; // Group starts counting at 0, so always display as group+1
    const assignedIds: Array<number> = [];

    // 1. Find scramblers, divide them into groups
    potentialScramblers = Helpers.sortScramblersByScramblingAssigned(this.wcif, potentialScramblers);
    this.moveTopCompetitorsToPositionsForLastGroup(potentialScramblers, event);
    potentialScramblers.forEach(p => {
      if (taskCounter[group]['S']['max'] > taskCounter[group]['S']['count']) {
        // Still room for another scrambler, so let's assign group & task to him/her!
        p[eventId].group = (group + 1) + ';S' + this.nextGroupOnSameStage(group, event);
        taskCounter[group]['S']['count']++;
        assignedIds.push(p.registrantId);
      }
      group = this.increment(group, event);
    });

    // 2. Find runners, divide them into groups
    group = 0;
    potentialRunners = potentialRunners.filter(p => this.isNotAssigned(p, assignedIds));
    potentialRunners = Helpers.sortRunnersByRunningAssigned(this.wcif, potentialRunners);
    this.moveTopCompetitorsToPositionsForLastGroup(potentialRunners, event);
    potentialRunners.forEach(p => {
      if (taskCounter[group]['R']['max'] > taskCounter[group]['R']['count']) {
        // Still room for another runner, so let's assign group & task to him/her!
        p[eventId].group = (group + 1) + ';R' + this.nextGroupOnSameStage(group, event);
        taskCounter[group]['R']['count']++;
        assignedIds.push(p.registrantId);
      }
      group = this.increment(group, event);
    });

    // 3. Assign everyone else
    group = 0;
    allCompetitors = allCompetitors.filter(p => this.isNotAssigned(p, assignedIds));
    this.moveTopCompetitorsToPositionsForLastGroup(allCompetitors, event);
    allCompetitors.forEach(p => {
      if (! this.configuration.doNotAssignJudges && this.canJudge(p) && taskCounter[group]['J']['max'] > taskCounter[group]['J']['count']) {
        // Still room for another judge, so let's assign group & task to him/her!
        p[eventId].group = (group + 1) + ';J' + this.nextGroupOnSameStage(group, event);
        taskCounter[group]['J']['count']++;
        assignedIds.push(p.registrantId);
      } else {
        p[eventId].group = (group + 1) + ''; // Person will compete in this group, but doesn't have a task
        assignedIds.push(p.registrantId);
      }
      group = this.increment(group, event);
    });

    if (this.configuration.fixedSeating && !this.configuration.doNotAssignJudges) {
      this.fillAllUsedTimersWithJudges(eventId);
    }
    this.swapNewCompetitorsAssignmentsSoTheyAlwaysCompeteFirstBeforeJudging();

    Helpers.countCJRSForEvent(this.wcif, eventId);
    Helpers.sortCompetitorsByName(this.wcif);
  }

  private moveTopCompetitorsToPositionsForLastGroup(competitors: Array<any>, event: any) {
    // Not entirely sure anymore what the logic is in this method :|
    if (this.isScrambleDependentEvent(event)) {
      const topCompetitors = Helpers.getTopCompetitorsBySpeedInEvent(this.wcif, event.id)
        .filter(p => competitors.includes(p));
      if (topCompetitors.length <= competitors.length / event.configuration.scrambleGroups) {
        for (let i = 0; i < topCompetitors.length; i++) {
          const m = i % event.configuration.stages;
          const g = Math.trunc(i / event.configuration.stages);
          let position = (g + 1) * this.numberOfGroups(event) - m - 1;
          const positionOfTopCompetitor = competitors.indexOf(topCompetitors[i]);
          if (position === -1 || positionOfTopCompetitor === -1 || positionOfTopCompetitor >= competitors.length) {
            throw new Error('Unexpected error!');
          }
          if (position >= competitors.length) {
            position = competitors.length - 1;
          }
          if (position !== positionOfTopCompetitor) {
            competitors[positionOfTopCompetitor] = competitors[position];
            competitors[position] = topCompetitors[i];
          }
        }
      } else {
        console.debug('Not doing top x in last group for event: ' + event.id);
        console.debug(competitors.length);
      }
    }
  }

  private isScrambleDependentEvent(event: any) {
    return ['222', '333', '333bf', '333oh', 'clock', 'pyram', 'skewb', 'sq1', '444bf'].includes(event.id);
  }

  private fillAllUsedTimersWithJudges(eventId: string) {
    const event: any = Helpers.getEvent(eventId, this.wcif);
    if (event.configuration.scrambleGroups <= 2) {
      return;
    }

    const numberOfGroups = event.configuration.scrambleGroups * event.configuration.stages;
    let group = 1;
    while (group <= numberOfGroups) {
      const competitors: number = Helpers.countCompetitors(this.wcif, eventId, group);
      let judges: number = Helpers.countJudges(this.wcif, eventId, group);

      if (judges < competitors) {
        const potentialJudges = this.availableForAnExtraJudgingTask(event, group);
        const neededJudges: number = competitors - judges;

        for (let i = 0; i < neededJudges && i < potentialJudges.length; i++) {
          Helpers.assignExtraJudge(potentialJudges[i], eventId, group);
          judges++;
        }
      }
      group++;
    }
  }

  private availableForAnExtraJudgingTask(event: any, group: number): any[] {
    const potentialJudges = this.wcif.persons.filter(p => p[event.id].competing
      && this.canJudge(p)
      && Helpers.notAssignedToAnythingYetInGroup(p[event.id].group, event, group));
    return Helpers.sortByCompetingToTaskRatio(this.wcif, event.id, potentialJudges);
  }

  private swapAssignments(a: Person, b: Person, event: any) {
    const assignmentA = a[event.id].group;
    const assignmentB = b[event.id].group;
    a[event.id].group = assignmentB;
    b[event.id].group = assignmentA;
  }

  private nextGroupOnSameStage(group: number, event: any) {
    return (((group + event.configuration.stages) % this.numberOfGroups(event)) + 1);
  }

  private markPersonsThatArePartOfTheStaff(staff: StaffPerson[]) {
    const staffWcaIds = staff.map(s => s.wcaId);
    this.wcif.persons.forEach(p => p.isStaff = staffWcaIds.includes(p.wcaId));
  }

  private numberOfGroups(event: any): number {
    return event.configuration.stages * event.configuration.scrambleGroups;
  }

  increment(group: number, event: any): number {
    return (group + 1) % this.numberOfGroups(event); // Go back to 0 on overflow
  }

  decrement(group: number, event: any): number {
    const numberOfGroups = this.numberOfGroups(event);
    return (group + numberOfGroups - 1) % numberOfGroups;
  }

  private isNotAssigned(p: any, assignedIds: Array<number>): boolean {
    return assignedIds.indexOf(p.registrantId) === -1;
  }

  public processWcif(): void {
    if (! this.wcif.events || this.wcif.events.length === 0) {
      alert('No events found! Please define all rounds and the schedule on the WCA website and then restart.');
      this.wcif = undefined;
      throw new Error('No events');
    }

    if (! this.wcif.persons || this.wcif.persons.length === 0) {
      alert('No competitors found! Maybe registration is not open yet?');
      this.wcif = undefined;
      throw new Error('No competitors');
    }

    for (const e of this.wcif.events) {
      e.numberOfRegistrations = 0; // Add field
      if (! e.rounds || ! e.rounds.length) {
        alert('No rounds found for ' + e.id + '! Please define all rounds and the schedule on the WCA website and then restart.');
        this.wcif = undefined;
        throw new Error('No rounds for ' + e.id);
      }
      e.round1 = e.rounds[0];
      e.numberOfRounds =  !e.rounds ? 0 : e.rounds.length;

      this.determineStartTimeOfEvent(e);
    }

    // All events should have a startTime now (if they're included in the schedule)
    this.sortEventsByStartTime();

    this.processRegistrationsOfPersons();

    this.setDefaultEventConfiguration();

    this.processRooms();
  }

  private processRegistrationsOfPersons() {
    // For every person: set registration fields per event to 1 or 0 (and count per event)
    const idsToRemove = [];
    for (const p of this.wcif.persons) {
      p.fullName = p.name;
      p.name = p.name.split('(')[0]; // Remove local name

      if (!p.registration || p.registration.status !== 'accepted') {
        idsToRemove.push(p.registrantId);
        continue;
      }
      for (const e of this.wcif.events) {
        if (p.registration.eventIds.indexOf(e.id) > -1) {
          p[e.id] = {competing: true, group: '1'};
          e.numberOfRegistrations++;
        } else {
          p[e.id] = {competing: false, group: ''};
        }
      }
    }

    // Remove registrations that are not accepted
    this.wcif.persons = this.wcif.persons.filter(p => idsToRemove.indexOf(p.registrantId) === -1);
  }

  private determineStartTimeOfEvent(e) {
    e.startTime = '';
    for (const v of this.wcif.schedule.venues) {
      for (const r of v.rooms) {
        for (const a of r.activities) {
          if (a.activityCode.startsWith(e.id + '-r1') // This is a round 1 of e
            && (e.startTime === '' || e.startTime > a.startTime)) { // Starttime is earlier than currently known
            e.startTime = a.startTime;
          }
        }
      }
    }
  }

  public importAssignmentsFromWcif(): void {
    this.resetGroupsForAllCompetitors();

    const allActivities: Activity[] = ActivityHelper.getAllActivitiesFromWcif(this.wcif);
    this.wcif.persons.forEach(p => this.readPersonAssignmentsFromWcif(p, allActivities));
    this.calculateStagesOfAllEvents();
  }

  private calculateStagesOfAllEvents() {
    this.wcif.events.forEach(event => {
      const groups = Helpers.countGroupsForEvent(this.wcif, event);
      if (groups > 0) {
        event.configuration.stages = groups / event.configuration.scrambleGroups;
      } else {
        event.configuration.stages = 1;
      }
    });
  }

  private resetGroupsForAllCompetitors() {
    this.wcif.persons.forEach(p => {
      this.wcif.events.forEach(e => {
        p[e.id].group = '';
      });
    });
  }

  private readPersonAssignmentsFromWcif(p: Person, allActivities: Activity[]) {
    this.sortAssignmentsByAssignmentCode(p);
    p.assignments.forEach(assignmentFromWcif => {
      const activity = allActivities.filter(a => a.id.toString() === assignmentFromWcif.activityId.toString());
      if (activity.length === 0) {
        return;
      }
      const code = parseActivityCode(activity[0].activityCode);
      if ((!!code.attemptNumber && code.attemptNumber !== 1)
        || code.roundNumber !== 1) {
        return;
      }

      if (p[(code.eventId)].group.length !== 0) {
        p[(code.eventId)].group += ';';
      }
      if (assignmentFromWcif.assignmentCode === 'competitor') {
        p[(code.eventId)].stationNumber = assignmentFromWcif.stationNumber;
      }
      p[(code.eventId)].group += this.convertAssignmentCodeFromWcif(assignmentFromWcif.assignmentCode);
      p[(code.eventId)].group += (code.groupNumber || 1).toString();
    });
  }

  private convertAssignmentCodeFromWcif(code: AssignmentCode) {
    switch (code) {
      case 'competitor':
        return '';
      case 'staff-judge':
        return 'J';
      case 'staff-scrambler':
        return 'S';
      case 'staff-runner':
        return 'R';
      case 'staff-dataentry':
        return 'D';
      case 'staff-announcer':
        return 'A';
    }
  }

  private sortAssignmentsByAssignmentCode(p: Person) {
    // codes: 'competitor' | 'staff-judge' | 'staff-scrambler' | 'staff-runner'
    p.assignments = p.assignments.sort((a, b) => a.assignmentCode.localeCompare(b.assignmentCode));
  }

  importAssignmentsFromCsv(callback: (competitors: number) => void) {
    const file = document.getElementById('importCsv')['files'][0];
    if (file) {
      const reader = new FileReader();
      reader.readAsText(file);
      reader.onload = function(e) {
        const csv: string = e.target['result'];
        const lines: string[] = csv.includes('\r\n') ? csv.split('\r\n') : csv.split('\n');
        const separator = this.determineSeparator(csv);
        const headers = lines[0].split(separator);
        const competitors = lines.splice(1);
        let importedCompetitorsCounter = 0;
        for (let i = 0; i < competitors.length; i++) {
          if (competitors[i] === null || competitors[i] === undefined || competitors[i] === '' || !competitors[i].includes(separator)) {
            continue;
          }
          const competitorToImport = competitors[i].split(separator);
          const matchingPersons = this.wcif.persons.filter(p => p.name === competitorToImport[0] || p.fullName === competitorToImport[0]);
          if (matchingPersons.length === 0) {
            continue;
          }
          for (let j = 1; j < headers.length; j++) {
            matchingPersons[0][headers[j]].group = competitorToImport[j];
          }
          importedCompetitorsCounter++;
        }
        this.calculateStagesOfAllEvents();
        callback(importedCompetitorsCounter);
      }.bind(this);
    } else {
      alert('Please select a CSV file to import first');
      throw Error('No CSV file to import');
    }
  }

  private determineSeparator(csv: string) {
    if (csv.includes(',')) {
      return ',';
    }
    if (csv.includes(';')) {
      return ';';
    }
    throw new Error('Could not determine separator (, or ;) in CSV file');
  }

  public setDefaultEventConfiguration() {
    const defaults: Array<EventConfiguration> = [
      { id: '222', stages: 1, scramblers: 2, runners: 2, timers: this.configuration.totalNumberOfTimers, totalTimers: this.configuration.totalNumberOfTimers, skip: false, scrambleGroups: 2 },
      { id: '333', stages: 1, scramblers: 2, runners: 2, timers: this.configuration.totalNumberOfTimers, totalTimers: this.configuration.totalNumberOfTimers, skip: false, scrambleGroups: 2 },
      { id: '444', stages: 1, scramblers: 2, runners: 2, timers: this.configuration.totalNumberOfTimers, totalTimers: this.configuration.totalNumberOfTimers, skip: false, scrambleGroups: 2 },
      { id: '555', stages: 1, scramblers: 2, runners: 2, timers: this.configuration.totalNumberOfTimers, totalTimers: this.configuration.totalNumberOfTimers, skip: false, scrambleGroups: 2 },
      { id: '666', stages: 1, scramblers: 2, runners: 1, timers: this.configuration.totalNumberOfTimers, totalTimers: this.configuration.totalNumberOfTimers, skip: false, scrambleGroups: 2 },
      { id: '777', stages: 1, scramblers: 2, runners: 1, timers: this.configuration.totalNumberOfTimers, totalTimers: this.configuration.totalNumberOfTimers, skip: false, scrambleGroups: 2 },
      { id: '333bf', stages: 1, scramblers: 1, runners: 1, timers: this.configuration.totalNumberOfTimers, totalTimers: this.configuration.totalNumberOfTimers, skip: false, scrambleGroups: 2 },
      { id: '333oh', stages: 1, scramblers: 2, runners: 2, timers: this.configuration.totalNumberOfTimers, totalTimers: this.configuration.totalNumberOfTimers, skip: false, scrambleGroups: 2 },
      { id: '333ft', stages: 1, scramblers: 2, runners: 1, timers: this.configuration.totalNumberOfTimers, totalTimers: this.configuration.totalNumberOfTimers, skip: false, scrambleGroups: 2 },
      { id: 'clock', stages: 1, scramblers: 2, runners: 2, timers: this.configuration.totalNumberOfTimers, totalTimers: this.configuration.totalNumberOfTimers, skip: false, scrambleGroups: 2 },
      { id: 'minx', stages: 1, scramblers: 2, runners: 2, timers: this.configuration.totalNumberOfTimers, totalTimers: this.configuration.totalNumberOfTimers, skip: false, scrambleGroups: 2 },
      { id: 'pyram', stages: 1, scramblers: 2, runners: 2, timers: this.configuration.totalNumberOfTimers, totalTimers: this.configuration.totalNumberOfTimers, skip: false, scrambleGroups: 2 },
      { id: 'skewb', stages: 1, scramblers: 2, runners: 2, timers: this.configuration.totalNumberOfTimers, totalTimers: this.configuration.totalNumberOfTimers, skip: false, scrambleGroups: 2 },
      { id: 'sq1', stages: 1, scramblers: 2, runners: 2, timers: this.configuration.totalNumberOfTimers, totalTimers: this.configuration.totalNumberOfTimers, skip: false, scrambleGroups: 2 },
      { id: '444bf', stages: 1, scramblers: 2, runners: 0, timers: this.configuration.totalNumberOfTimers, totalTimers: this.configuration.totalNumberOfTimers, skip: true, scrambleGroups: 1 },
      { id: '555bf', stages: 1, scramblers: 2, runners: 0, timers: this.configuration.totalNumberOfTimers, totalTimers: this.configuration.totalNumberOfTimers, skip: true, scrambleGroups: 1 },
      { id: '333mbf', stages: 1, scramblers: 2, runners: 0, timers: this.configuration.totalNumberOfTimers, totalTimers: this.configuration.totalNumberOfTimers, skip: true, scrambleGroups: 1 },
      { id: '333fm', stages: 1, scramblers: 2, runners: 0, timers: this.configuration.totalNumberOfTimers, totalTimers: this.configuration.totalNumberOfTimers, skip: true, scrambleGroups: 1 },
    ];

    for (const e of this.wcif.events) {
      e.configuration = defaults.filter(d => d.id === e.id)[0];
      e.configuration.scrambleGroups = Math.max(e.round1.scrambleSetCount, e.configuration.scrambleGroups);
    }
  }

  private canJudge(person): boolean {
    if (this.configuration.doNotAssignTasksToNewCompetitors && !person.wcaId) {
      return false;
    }

    if (this.configuration.skipDelegatesAndOrganizers
      && Helpers.isOrganizerOrDelegate(person)) {
      return false;
    }

    return true;
  }

  private canScramble(person, staff: StaffPerson[], event): boolean {
    const x = staff.filter(s => s.wcaId === person.wcaId);
    if (x.length === 1) {
      return x[0].isAllowedTo.indexOf('scrambleEverything') > -1 || x[0].isAllowedTo.indexOf(event) > -1;
    }
    return false;
  }

  private canRun(person, staff: StaffPerson[]): boolean {
    const x = staff.filter(s => s.wcaId === person.wcaId);
    if (x.length === 1) {
      return x[0].isAllowedTo.indexOf('run') > -1;
    }
    return false;
  }

  private shuffleCompetitors() {
    let i, j, x;
    for (i = this.wcif.persons.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      x = this.wcif.persons[i];
      this.wcif.persons[i] = this.wcif.persons[j];
      this.wcif.persons[j] = x;
    }
  }

  private sortEventsByStartTime() {
    this.wcif.events = this.wcif.events.sort(function(a, b) {
      const textA = a.startTime;
      const textB = b.startTime;
      if (textA === '') {
        return 1;
      }
      if (textB === '') {
        return -1;
      }
      return (textA < textB) ? -1 : (textA > textB) ? 1 : 0;
    });
  }

  private createTaskCounter(configuration: EventConfiguration) {
    const numberOfGroups: number = configuration.stages * configuration.scrambleGroups;
    const tasks = [
      {	'J': { 'max': configuration.timers, 'count': 0 },
        'R': { 'max': configuration.runners, 'count': 0 },
        'S': { 'max': configuration.scramblers, 'count': 0 } }
    ];
    for (let i = 0; i < numberOfGroups; i++) {
      tasks.push( JSON.parse(JSON.stringify(tasks[0])));
    }
    return tasks;
  }

  countCJRSForEvent(id: any, numberOfGroupsForEvent?: number) {
    return Helpers.countCJRSForEvent(this.wcif, id, numberOfGroupsForEvent);
  }

  private getStaffFile() {
    if (!!this.document) {
      return this.document.getElementById('staff')['files'][0];
    }
    return null;
  }

  private swapNewCompetitorsAssignmentsSoTheyAlwaysCompeteFirstBeforeJudging() {
    this.wcif.persons.forEach(p => {
      if (!p.wcaId) {
        const event = Helpers.findFirstEventOfPerson(this.wcif, p);
        if (event !== null && !Helpers.competesBeforeJudging(p, event.id)) {
          const potentialSwaps = this.wcif.persons.filter(potentialSwap => !!potentialSwap.wcaId
            && Helpers.competesBeforeJudging(potentialSwap, event.id)
            && Assignment.fromString(p[event.id].group).similarTasksAs(potentialSwap[event.id].group));
          if (potentialSwaps.length > 0) {
            this.swapAssignments(p, potentialSwaps[0], event);
          }
        }
      }
    });
  }

  private processRooms() {
    this.configuration.rooms = Helpers.getAllRooms(this.wcif).map(room => ({
      id: room.id,
      name: room.name,
      color: room.color,
      stationNumberFrom: 1,
      // stationNumberTo: room.extensions?.filter(e => e.id === 'groupifier.RoomConfig')?.[0]?.data?.['stations'] || 1000,
    }));
  }

  // splitRoom(index: number) {
  //   this.configuration.printColorsOnTableOverview = true;
  //   this.configuration.printColorsOnPersonalSchedules = true;
  //
  //   const room = this.configuration.rooms[index];
  //   const split = room.stationNumberFrom + Math.floor((room.stationNumberTo - room.stationNumberFrom) / 2);
  //   this.configuration.rooms.splice(index, 0, {
  //     id: room.id,
  //     name: room.name,
  //     color: room.color,
  //     stationNumberFrom: split + 1,
  //     stationNumberTo: room.stationNumberTo,
  //   });
  //   room.stationNumberTo = split;
  // }

}

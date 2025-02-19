import {Activity} from '@wca/helpers';
import * as moment from 'moment-timezone';
import {activityCodeToName, parseActivityCode, ParsedActivityCode} from '@wca/helpers/lib/helpers/activity';
import {Helpers} from './helpers';
import {GeneralConfiguration, Wcif} from './classes';

export class ActivityHelper {

  public static addChildActivitiesForEveryRound(wcif) {
    let currentId = this.getHighestActivityId(wcif) + 1;
    wcif.schedule.venues.forEach(v => {
      v.rooms.forEach(r => r.activities.forEach(a => {
        if (! a.activityCode.startsWith('other')) {
          const activityCode = parseActivityCode(a.activityCode);
          const event = Helpers.getEvent(activityCode.eventId, wcif);
          this.createChildActivitiesFor(wcif, a, event);
          currentId = this.assignIdsToChildActivities(a.childActivities, currentId);
        }
      }));
    });
  }

  private static createChildActivitiesFor(wcif, activity: Activity, event): void {
    if (this.hasExpectedNumberOfChildActivities(wcif, activity, event)) {
      return;
    }

    activity.childActivities = [];

    const numberOfGroups = event.configuration.scrambleGroups;
    const numberOfStages = event.configuration.stages;
    const timesOfGroups = this.splitInGroups(activity.startTime, activity.endTime, numberOfGroups);

    for (let groupIndex = 0; groupIndex < numberOfGroups; groupIndex++) {
      for (let stageIndex = 0; stageIndex < numberOfStages; stageIndex++) {
        const code = this.addGroupToCodeOfActivity(activity, groupIndex, stageIndex, numberOfStages);

        const childActivity = {
          id: null,
          name: activityCodeToName(code),
          activityCode: code,
          startTime: timesOfGroups[groupIndex],
          endTime: timesOfGroups[groupIndex + 1],
          childActivities: [],
          scrambleSetId: null,
          extensions: [],
        };
        activity.childActivities.push(childActivity);
      }
    }
  }

  private static hasExpectedNumberOfChildActivities(wcif, activity: Activity, event) {
    return !!activity.childActivities && !!activity.childActivities.length
      && (activity.childActivities.length === event.configuration.scrambleGroups ||
        activity.childActivities.length === event.configuration.scrambleGroups * event.configuration.stages);
  }

  private static addGroupToCodeOfActivity(a: Activity, groupIndex: number, stageIndex: number, numberOfStages: number) {
    const activityCode = parseActivityCode(a.activityCode);
    activityCode.groupNumber = 1 + Math.round(stageIndex + groupIndex * numberOfStages);
    return this.formatActivityCode(activityCode);
  }

  private static formatActivityCode(activityCode: ParsedActivityCode) {
    let formattedActivityCode = activityCode.eventId + '-r' + activityCode.roundNumber + '-g' + activityCode.groupNumber;
    if (!!activityCode.attemptNumber) {
      formattedActivityCode += ('-a' + activityCode.attemptNumber);
    }
    return formattedActivityCode;
  }

  public static getAllActivitiesFromWcif(wcif): Activity[] {
    const allActivities: Activity[] = [];
    wcif.schedule.venues.forEach(v => {
      v.rooms.forEach(r => r.activities.forEach(a => {
        allActivities.push(a);
        a.childActivities.forEach(childActivity => allActivities.push(childActivity));
      }));
    });
    return allActivities;
  }

  private static getHighestActivityId(wcif) {
    const activities = this.getAllActivitiesFromWcif(wcif);
    return Math.max(...activities.map(a => a.id));
  }

  private static splitInGroups(startTime: string, endTime: string, numberOfGroups: number): string[] {
    const startMoment = moment(startTime);
    const endMoment = moment(endTime);
    const durationOfOneGroupAsMilliseconds = moment.duration(endMoment.diff(startMoment)).asMilliseconds() / numberOfGroups;

    const allTimes = [startTime];
    for (let i = 1; i < numberOfGroups; i++) {
      const endOfGroup = moment(startMoment).add(durationOfOneGroupAsMilliseconds * i);
      allTimes.push(endOfGroup.tz('UTC').format());
    }
    allTimes.push(endTime);
    return allTimes;
  }

  private static assignIdsToChildActivities(childActivities: Activity[], currentId: number) {
    childActivities.forEach(a => a.id = currentId++);
    return currentId;
  }

  static createAssignmentsInWcif(wcif: Wcif, configuration: GeneralConfiguration) {
    // TODO Write a test for this method
    this.resetAssignmentsOfAllPersons(wcif);

    for (const venue of wcif.schedule.venues) {
      for (const room of venue.rooms) {
        for (const activity of room.activities) {
          for (const childActivity of activity.childActivities.filter(a => a.activityCode.includes('-r1-g'))) {
            const stationNumberFrom = configuration.rooms.filter(r => r.id === room.id)?.[0]?.stationNumberFrom || 1;

            const activityCode = parseActivityCode(childActivity.activityCode);
            const competitors = wcif.persons.filter(p => p[activityCode.eventId].group.split(';')[0] === ('' + activityCode.groupNumber));
            competitors.forEach((competitor, index) => {
              this.createAssignmentFor(competitor, childActivity, 'competitor', stationNumberFrom + index);

              // TODO Refactor: this must be done whenever stationNumbers of stages change!
              competitor[activityCode.eventId].stationNumber = stationNumberFrom + index;
              competitor[activityCode.eventId].stageColor = room.color;
            });
            const judges = wcif.persons.filter(p => p[activityCode.eventId].group.split(';').includes('J' + activityCode.groupNumber));
            judges.forEach(judge => this.createAssignmentFor(judge, childActivity, 'staff-judge', null));
            const scramblers = wcif.persons.filter(p => p[activityCode.eventId].group.split(';').includes('S' + activityCode.groupNumber));
            scramblers.forEach(scrambler => this.createAssignmentFor(scrambler, childActivity, 'staff-scrambler', null));
            const runners = wcif.persons.filter(p => p[activityCode.eventId].group.split(';').includes('R' + activityCode.groupNumber));
            runners.forEach(runner => this.createAssignmentFor(runner, childActivity, 'staff-runner', null));
          }
        }
      }
    }
  }

  private static resetAssignmentsOfAllPersons(wcif: Wcif) {
    wcif.persons.forEach(p => {
      p.assignments = [];
    });
  }

  private static createAssignmentFor(person: any, activity: Activity, assignmentCode: string, stationNumber: number) {
    person.assignments.push({
      activityId: activity.id,
      stationNumber: stationNumber,
      assignmentCode: assignmentCode
    });
  }

}

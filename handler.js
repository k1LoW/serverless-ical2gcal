'use strict';
const config = require('./config.js').config();
const axios = require('axios');
const async = require('async');
const ical = require('ical.js');
const google = require('googleapis');
const gcal = google.calendar('v3');
const key = require(config.keyPath);
const scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.readonly'
];

const jwtClient = new google.auth.JWT(
    key.client_email,
    null,
    key.private_key,
    scopes,
    null
);
module.exports.sync = (event, context, callback) => {
    let insertEvents = [];
    let deleteEvents = [];
    let tasks = [];

    function pushGcalInsertTask(vevents) {
        vevents.forEach((vevent) => {
            const event = new ical.Event(vevent);
            let resource = {
                summary: event.summary,
                description: event.description,
                location: event.location
            };
            if (event.startDate.toString().match(/T/)) {
                resource['start'] = {
                    dateTime: event.startDate.toString(),
                    timeZone: config.timeZone
                };
            } else {
                resource['start'] = {
                    date: event.startDate.toString(),
                    timeZone: config.timeZone
                };
            }
            if (event.endDate.toString().match(/T/)) {
                resource['end'] = {
                    dateTime: event.endDate.toString(),
                    timeZone: config.timeZone
                };
            } else {
                resource['end'] = {
                    date: event.endDate.toString(),
                    timeZone: config.timeZone
                };
            }

            tasks.push((callback) => {
                gcal.events.insert({
                    calendarId: config.calendarId,
                    auth: jwtClient,
                    resource: resource
                }, (err, resp) => {
                    if (err) {
                        console.log(err);
                    }
                    setTimeout(() => {callback(null, resp);}, 1000);
                });
            });
        });
    }

    function pushGcalDeleteTask(vevents) {
        vevents.forEach((vevent) => {
            tasks.push((callback) => {
                gcal.events.delete({
                    calendarId: config.calendarId,
                    auth: jwtClient,
                    eventId: vevent.id
                }, (err, resp) => {
                    if (err) {
                        console.log(err);
                    }
                    setTimeout(() => {callback(null, resp);}, 1000);
                });
            });
        });
    }

    function listGcalEvents(nextPageToken) {
        gcal.events.list({
            calendarId: config.calendarId,
            maxResults: 2500,
            pageToken: nextPageToken,
            auth: jwtClient
        }, (err, resp) => {
            if (err) {
                console.log(err);
            }

            deleteEvents = deleteEvents.concat(resp.items);

            if (resp.nextPageToken) {
                listGcalEvents(resp.nextPageToken);
                return;
            }

            executeTask();
        });
    }

    function executeTask() {
        let executeInsertEvents = [];
        let executeDeleteEvents = deleteEvents;
        insertEvents.forEach((vevent) => {
            const event = new ical.Event(vevent);
            const finded = deleteEvents.find((vevent) => {
                let iStart, iEnd, dStart, dEnd;
                if (event.startDate.toString().match(/T/)) {
                    iStart = new Date(event.startDate.toString() + '+09:00');
                } else {
                    iStart = new Date(event.startDate.toString() + 'T00:00:00+09:00');
                }
                if (event.endDate.toString().match(/T/)) {
                    iEnd = new Date(event.endDate.toString() + '+09:00');
                } else {
                    iEnd = new Date(event.endDate.toString() + 'T00:00:00+09:00');
                }
                if (vevent.start.date) {
                    dStart = new Date(vevent.start.date + 'T00:00:00+09:00');
                } else {
                    dStart = new Date(vevent.start.dateTime);
                }
                if (vevent.end.date) {
                    dEnd = new Date(vevent.end.date + 'T00:00:00+09:00');
                } else {
                    dEnd = new Date(vevent.end.dateTime);
                }
                return (event.summary == vevent.summary
                        && event.description == vevent.description
                        && iStart.getTime() == dStart.getTime()
                        && iEnd.getTime() == dEnd.getTime());
            });
            if (finded) {
                executeDeleteEvents = executeDeleteEvents.filter((vevent) => {
                    return vevent != finded;
                });
            } else {
                executeInsertEvents.push(vevent);
            }
        });

        pushGcalInsertTask(executeInsertEvents);
        pushGcalDeleteTask(executeDeleteEvents);

        console.log('Execute tasks: ' + tasks.length);

        async.parallelLimit(tasks, 5, (err, results) => {
            const message = 'Synced';
            console.log(message);
            callback(null, message);
        });
    }

    axios.get(config.icalUrl).then((res) => {
        const component = new ical.Component(ical.parse(res.data));
        const vevents = component.getAllSubcomponents('vevent');
        if (vevents.length == 0) {
            throw 'Can not get vevents from URL';
        }

        insertEvents = insertEvents.concat(vevents);

        listGcalEvents(null);
    }).catch((err) => {
        console.log(err);
    });
};

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
    let tasks = [];

    function pushGcalDeleteTask(nextPageToken) {
        gcal.events.list({
            calendarId: config.calendarId,
            maxResults: 2500,
            pageToken: nextPageToken,
            auth: jwtClient
        }, (err, resp) => {
            if (err) {
                console.log(err);
            }
            resp.items.forEach((vevent) => {
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

            console.log('Push gcal delete tasks: ' + resp.items.length);
            
            if (resp.nextPageToken) {
                pushGcalDeleteTask(resp.nextPageToken);
                return;
            }
            
            executeTask();
        });
    } 

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
    
    function executeTask() {
        console.log('Execute tasks: ' + tasks.length);
        async.parallelLimit(tasks, 5, (err, results) => {
            const response = {
                statusCode: 200,
                body: JSON.stringify({
                    message: 'Synced'
                })
            };
            callback(null, response);
        });
    }
    
    axios.get(config.icalUrl).then((res) => {
        const component = new ical.Component(ical.parse(res.data));
        const vevents = component.getAllSubcomponents('vevent');

        pushGcalInsertTask(vevents);

        console.log('Push gcal insert tasks: ' + vevents.length);
        
        pushGcalDeleteTask(null);
        
    }).catch((err) => {
        console.log(err);
    });
};

/**
 * MIT License

Copyright (c) 2020 almostSouji

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
 */

import { WebhookClient, MessageEmbed } from 'discord.js';
import axios from 'axios';
import type { StatusPageIncident, StatusPageResult } from './interface/StatusPage';
import { DateTime } from 'luxon';
import { config } from 'dotenv';
import db from 'quick.db';
import Agenda from 'agenda';
import { connect } from 'mongoose';
import { exec } from 'child_process';
import {
    EMBED_COLOR_GREEN,
    EMBED_COLOR_RED,
    EMBED_COLOR_ORANGE,
    EMBED_COLOR_YELLOW,
    EMBED_COLOR_BLACK,
    API_BASE,
} from './constants';
import Incident from './models/Incident';
import { cast, sleep } from './utils';

import type { IncientTable } from './interface/Table';

config();
const agenda = new Agenda({ db: { address: process.env.MONGO_URL!, collection: 'agendaJobs' } });
const incidentTable = new db.table('incidents');

const hook = new WebhookClient({ id: cast<string>(process.env.DISCORD_WEBHOOK_ID!), token: cast<string>(process.env.DISCORD_WEBHOOK_TOKEN!) });
function embedFromIncident(incident: StatusPageIncident): MessageEmbed {
    const color =
        incident.status === 'resolved' || incident.status === 'postmortem'
            ? EMBED_COLOR_GREEN
            : incident.impact === 'critical'
                ? EMBED_COLOR_RED
                : incident.impact === 'major'
                    ? EMBED_COLOR_ORANGE
                    : incident.impact === 'minor'
                        ? EMBED_COLOR_YELLOW
                        : EMBED_COLOR_BLACK;

    const affectedNames = incident.components.map((c) => c.name);

    const embed = new MessageEmbed()
        .setColor(color)
        .setTimestamp(new Date(incident.started_at))
        .setURL(incident.shortlink)
        .setTitle(incident.name)
        .setFooter({ text: incident.id });

    for (const update of incident.incident_updates.reverse()) {
        const updateDT = DateTime.fromISO(update.created_at);
        const timeString = `<t:${Math.floor(updateDT.toSeconds())}:R>`;
        embed.addField(`${update.status.charAt(0).toUpperCase()}${update.status.slice(1)} (${timeString})`, update.body);
    }

    const descriptionParts = [`• Impact: ${incident.impact}`];

    if (affectedNames.length) {
        descriptionParts.push(`• Affected Components: ${affectedNames.join(', ')}`);
    }

    embed.setDescription(descriptionParts.join('\n'));

    return embed;
}

async function updateIncident(incident: StatusPageIncident, messageID?: string) {
    const embed = embedFromIncident(incident);
    try {
        const message = await (messageID ? hook.editMessage(messageID, { embeds: [embed] }) : hook.send({ embeds: [embed] }));
        console.debug(`setting: ${incident.id} to message: ${message.id}`);
        incidentTable.set(incident.id, {
            incidentID: incident.id,
            lastUpdate: DateTime.now().toISO(),
            messageID: message.id,
            resolved: incident.status === 'resolved' || incident.status === 'postmortem',
        });

    } catch (error) {
        if (messageID) {
            console.error(`error during hook update on incident ${incident.id} message: ${messageID}\n`, error);
            return;
        }
        console.error(`error during hook sending on incident ${incident.id}\n`, error);
    }
}

async function check() {
    console.info('heartbeat');
    try {
        const json = (await axios(`${API_BASE}/incidents.json`).then((r) => r.data)) as StatusPageResult;
        const { incidents } = json;

        for (const incident of incidents.reverse()) {
            const data = incidentTable.get(incident.id);

            if (!data) {
                console.info(`new incident: ${incident.id}`);
                await updateIncident(incident);
                continue;
            }

            const incidentUpdate = DateTime.fromISO(incident.updated_at ?? incident.created_at, { zone: 'UTC+7' });
            if (DateTime.fromISO(data.lastUpdate) < incidentUpdate) {
                console.info(`update incident: ${incident.id}`);
                await updateIncident(incident, data.messageID);
            }
        }


    } catch (error) {
        console.error(`error during fetch and update routine:\n`, error);
    }
}

async function addDataToMongo() {
    const allDB = incidentTable.fetchAll() as IncientTable[];
    if (!allDB.length) return;
    allDB.forEach(async (entry) => {
        await sleep(500);
        const { data } = entry;
        const incident = await Incident.findOne({ incidentID: data.incidentID });
        if (!incident) {
            const newIncident = new Incident({
                incidentID: data.incidentID,
                lastUpdate: data.lastUpdate,
                messageID: data.messageID,
                resolved: data.resolved,
            });
            await newIncident.save();
        }

        incident!.incidentID = data.incidentID;
        incident!.lastUpdate = data.lastUpdate;
        incident!.messageID = data.messageID;
        incident!.resolved = data.resolved;

        await incident?.save();
    })
}

agenda.define('check update', { priority: 10 }, async () => {
    await check();
});

agenda.define('add data to mongo', async () => {
    await addDataToMongo();
});

agenda.define('git pull', () => {
    exec('git pull', (error, stdout, stderr) => {
        const response = (stdout || stderr);
        if (!error) {
            if (!response.includes('Already up to date.')) {
                console.log(response);
                setTimeout(() => {
                    process.exit();
                }, 1000);
            }
        }
    })
});

(async function () {
    await check();
    await connect(process.env.MONGO_URL!, { dbName: 'incidents' });
    await agenda.start();

    await agenda.every('5 minutes', 'check update');
    await agenda.every('1 day', 'add data to mongo');
    await agenda.every('30 seconds', 'git pull');

})();
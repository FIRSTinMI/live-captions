const { execFileSync } = require('child_process');
const { parse } = require('csv-parse');
const { readFileSync } = require('fs');

async function getDeviceList(program_folder) {
    execFileSync(`${program_folder}/SoundVolumeView.exe`, ['/scomma', `${program_folder}/devices.csv`]);

    return await new Promise((resolve, reject) => parse(readFileSync(`${program_folder}/devices.csv`), {}, (err, records) => {
        records = records.filter((arr) => (arr[2] === 'Capture' && arr[1] === 'Device'));
        resolve(records.map((row) => `${row[0]} (${row[3]})`));
    }));
}

module.exports = getDeviceList;
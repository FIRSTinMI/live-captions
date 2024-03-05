import { v2 } from '@google-cloud/speech';
const SpeechClient = v2.SpeechClient;

const auth = {
    "projectId": "fim-closed-captions",
    "scopes": "https://www.googleapis.com/auth/cloud-platform",
    "credentials": {
        "client_email": "",
        "private_key": ""
    }
}

const phraseSets = [
    'projects/829228050742/locations/global/phraseSets/fim-2024-team-names',
    'projects/829228050742/locations/global/phraseSets/frc-2024-terms'
];

const speech = new SpeechClient(auth);
for (let phraseSet of phraseSets) {
    speech.getPhraseSet({ name: phraseSet }).then(res => {
        speech.updatePhraseSet({
            phraseSet: {
                name: res[0].name, phrases: res[0].phrases?.map(p => ({ value: p.value, boost: 10 })) || []
            }
        })
    });
}

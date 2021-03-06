var fs = require('fs');
var readline = require('readline');
var google = require('googleapis');
var googleAuth = require('google-auth-library');

var SCOPES = ['https://www.googleapis.com/auth/drive.metadata.readonly', 'https://www.googleapis.com/auth/drive.readonly'];
var TOKEN_DIR = (process.env.HOME || process.env.HOMEPATH ||
	process.env.USERPROFILE) + '/.credentials/';
var TOKEN_PATH = TOKEN_DIR + 'drive-nodejs-quickstart.json';

/**
 * Authorises the app, returning the auth
 * @return {Promise<AuthObj>}
 */
function authorize() {
	function storeToken(token) {
		try {
			fs.mkdirSync(TOKEN_DIR);
		} catch (err) {
			if (err.code != 'EEXIST') {
				throw err;
			}
		}
		fs.writeFile(TOKEN_PATH, JSON.stringify(token));
		console.log('Token stored to ' + TOKEN_PATH);
	}
	function getNewToken(oauth2Client, callback) {
		return new Promise(function(resolve, reject) {
			var authUrl = oauth2Client.generateAuthUrl({
				access_type: 'offline',
				scope: SCOPES
			});
			console.log('Authorize this app by visiting this url: ', authUrl);
			var rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout
			});
			rl.question('Enter the code from that page here: ', function(code) {
				rl.close();
				oauth2Client.getToken(code, function(err, token) {
					if (err) {
						console.log('Error while trying to retrieve access token', err);
						reject(new Error('Error while trying to retrieve access token' + err));
						return;
					}
					oauth2Client.credentials = token;
					storeToken(token);
					resolve(oauth2Client);
				});
			});
		});
	}
	return new Promise(function(resolve, reject) {
		fs.readFile('app/client_secret.json', function processClientSecrets(err, content) {
			if (err) {
				console.log('Error loading client secret file: ' + err);
				reject(new Error('Error loading client secret file: ' + err));
				return;
			}
			var credentials = JSON.parse(content);
			var clientSecret = credentials.installed.client_secret;
			var clientId = credentials.installed.client_id;
			var redirectUrl = credentials.installed.redirect_uris[0];
			var auth = new googleAuth();
			var oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);

			// Check if we have previously stored a token.
			fs.readFile(TOKEN_PATH, function(err, token) {
				if (err) {
					resolve(getNewToken(oauth2Client));
				} else {
					oauth2Client.credentials = JSON.parse(token);
					resolve(oauth2Client);
				}
			});
		});
	});
}

var drive = google.drive('v3'),
	auth = authorize();

module.exports = {
	/**
	 * Downloads file, returns a stream
	 * @param  {string} id The file's id
	 * @return {Promise<stream>}
	 */
	getFile: function(id) {
		return auth.then(function(authObj) {
			return drive.files.get({
				auth: authObj,
				fileId: id,
				alt: 'media'
			});
		});
	}
};

// Use bluebird's promise for better quality and polyfill-less environment
global.Promise = require('bluebird');

const fs = require('fs');
const path = require('path');
const jsonminify = require('jsonminify');
const Discordie = require('discordie');

var app = new Discordie({
	autoReconnect: true
});
app.Config = JSON.parse(jsonminify(fs.readFileSync('config.json', 'utf8')));
app.broadcastChannel = app.Config.connection.broadcast;

var Problem = require('./app/problem')(app);
// app.problems = {};
// app.submissions = {};
//
// require('./app/listeners')(app);
//
// app.loginWithToken(app.Config.connection.token).then(function() {
// 	console.log('Logged in!');
// });

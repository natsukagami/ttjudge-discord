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
app.reply = app.sendMessage = (origin, message) => {
	if (typeof origin === 'string') {
		origin = app.Channels.get(origin);
	} else origin = origin.channel;
	return origin.sendMessage(message);
};
app.connect({token: app.Config.connection.token});
app.startTyping = (origin) => {
	return origin.channel.sendTyping();
};

var Problem = require('./app/problem')(app);

app.problems = {};
app.submissions = {};

require('./app/listeners')(app);

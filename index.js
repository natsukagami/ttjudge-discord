// Use bluebird's promise for better quality and polyfill-less environment
global.Promise = require('bluebird');

var fs = require('fs');
var path = require('path');
var jsonminify = require('jsonminify');
var discord = require('discord.js');

var app = new discord.Client();
app.Config = JSON.parse(jsonminify(fs.readFileSync('config.json', 'utf8')));
app.broadcastChannel = app.Config.connection.broadcast;
app.sendMessage = function(channel, message, options) {
	return discord.Client.prototype.sendMessage.call(this, channel, message, options).then(function(message) {
		if ((!options || !options.preserveMessage) && !message.channel.isPrivate) app.deleteMessage(message, {
			wait: 1000 * app.Config.bot.messageTimeout
		});
		return message;
	});
};

var Problem = require('./app/problem')(app);
app.problems = {};
app.submissions = {};

require('./app/listeners')(app);

app.loginWithToken(app.Config.connection.token).then(function() {
	console.log('Logged in!');
});

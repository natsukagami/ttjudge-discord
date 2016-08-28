const EventEmitter = require('events');
const path = require('path');
const uuid = require('uuid');
const fs = Promise.promisifyAll(require('fs-extra'), {multiArgs: true});
const md = require('markdown-creator');
const cp = Promise.promisifyAll(require('child_process'));
const temp = Promise.promisifyAll(require('temp')).track();
const unzip = require('unzip');
const download = function download(url, dest) {
	return cp.execAsync('wget ' + url, {cwd: dest});
};
md.inlineCode = function(text) {
	return '`' + text + '`';
};

let dir = temp.mkdirSync();

let router = new EventEmitter();
let Drive = require('./drive');

let lastSubmissions = {};
let subsBy = {};
let allsubs = [];

let commands = {
	'!help': 'What are you reading lol',
	'!submit [problem]': 'PM this to me, with an attachment that is your code. Problem name is optional, if it\'s not provided it will be guessed from the file\'s name. You can even omit the `!submit` part',
	'!problems': 'List all problems available to judging',
	'!problem [name]': 'See the time and memory limits of a problem',
	'!statements [name]': 'Get the statements of a problem',
	'!verdict {id}': 'See the verdict of the submission with provided id',
	'!details {id}': 'See the detailed verdict of the submission with provided id',
	'!download {id}': 'PM this to me to get a submission you submitted',
	'!mysubs': 'List all your past submissions',
	'!allsubs': 'List most recent submissions'
};

module.exports = function(app) {
	let Submission = require('./submission')(app);
	let Problem = require('./problem')(app);
	/**
	 * Splits the command into events
	 */
	app.Dispatcher.on('MESSAGE_CREATE', function(message) {
		message = message.message;
		// Not command, pass
		if (message.author.id === app.User.id) return; // From me
		if (!message.channel.isPrivate && message.channel.id !== app.broadcastChannel) return;
		if (!message.content.length && message.attachments.length === 1 && message.channel.isPrivate) {
			router.emit('!submit', message, []);
			return;
		}
		if (!message.content.length || message.content.charAt(0) != app.Config.bot.commandPrefix) return;
		let evtyp = message.content.split(/\s+/);
		console.log(evtyp);
		router.emit(evtyp[0], message, evtyp.slice(1));
	});

	function listProblems(message, args) {
		if (!Object.keys(app.problems).length) {
			app.sendMessage(message, 'Why am I so lonely? T.T');
			return;
		}
		app.startTyping(message);
		app.sendMessage(message, 'Problems currently online\n\n').then(function() {
			let mes = '';
			return Promise.all(Object.keys(app.problems).map(function(pid, id, arr) {
				mes += '  ' + app.problems[pid].getTitle() + '\n';
				if (id % 10 === 9 || id === arr.length - 1) {
					if (mes !== '') {
						return app.sendMessage(message, mes), mes = '';
					}
				}
			}));
		});
	}

	function scanProblems() {
		fs.readdir('problems', function(err, files) {
			files.forEach(function(file) {
				fs.stat(path.join('problems', file), function(err, stats) {
					if (stats.isDirectory() && !app.problems[file.toUpperCase()]) {
						let problem = new Problem(path.join('problems', file), file.toUpperCase());
						problem.onReady().then(function() {
							if (problem.ready) {
								console.log('Problem ' + problem.name + ' ready, ' + problem.testcases.length + ' tests found.');
								app.problems[problem.name] = problem;
							}
						});
					}
				});
			});
		});
	}
	app.Dispatcher.on('GATEWAY_READY', function() {
		scanProblems();
		app.sendMessage(app.broadcastChannel, 'Type !help for more commands!');
	});
	// Listeners here

	router.on('!submit', function submit(message, args) {
		let user = message.author;
		if (!message.channel.isPrivate) {
			app.reply(message, 'Please send your submission to just me :heart: and me alone :heart:');
			return;
		}
		if (message.attachments.length < 1) {
			app.reply(message, 'Uhh,... where\'s your file?');
			return;
		}
		if (message.attachments.length > 1) {
			app.reply(message, 'Please submit only one file at a time! I\'m very :bus:y, you know.');
			return;
		}
		if (lastSubmissions[user.id] && (new Date()) - lastSubmissions[user.id] < 1000 * app.Config.submissions.submissionLimit) {
			let timeLeft = (1000 * app.Config.submissions.submissionLimit - ((new Date()) - lastSubmissions[user.id])) / 1000;
			app.reply(message, '/tableflip Hush hush, lemme rest a littttle! Wait ' + Math.round(timeLeft) + ' seconds and submit again!');
			return;
		}
		let file = message.attachments[0];
		if (file.size > app.Config.submissions.maxFileSize) {
			app.reply(message, 'It\'s too large, it will never fit inside me... :cry: The file, I mean.');
			return;
		}
		if (app.Config.submissions.fileTypes.indexOf(path.extname(file.filename).toLowerCase()) === -1) {
			app.reply(message, 'What type of file is this... Black magic?');
			return;
		}
		let problem = (args[0] || path.basename(file.filename, path.extname(file.filename))).toUpperCase();
		if (app.problems[problem] === undefined) {
			app.reply(message, 'Hmm... Whatever problem you\'re trying to solve, it\'s not here.');
			return;
		}
		lastSubmissions[user.id] = new Date();
		app.startTyping(message);
		let filepath = path.join(dir, uuid.v4() + path.extname(file.filename).toLowerCase());
		temp.mkdirAsync('').then(function(dirf) {
			download(file.url, dirf).then(function() {
				return fs.moveAsync(path.join(dirf, file.filename), filepath);
			}).then(function() {
				let submission = new Submission(app.problems[problem], user, filepath);
				app.submissions[submission.id] = submission;
				if (!subsBy[user.id]) subsBy[user.id] = [];
				subsBy[user.id].unshift(submission.id);
				allsubs.unshift(submission.id);
				if (allsubs.length > 20) {
					delete app.submissions[allsubs.pop()];
				}
				app.reply(message, 'Your submission (id = ' + md.bold(submission.id + '') + ', problem = ' + md.bold(submission.problem.name) + ', submit time = ' + (new Date()) + ') is now in queue~');
				app.sendMessage(app.broadcastChannel, submission.getName() + ' is now in queue!');
				submission.doJudge();
			});
		});
	});

	router.on('!verdict', function(message, args) {
		let id = args[0];
		if (!id || isNaN(Number(id))) {
			app.sendMessage(message, 'So, what do you want to see? Gimme an id or something');
			return;
		}
		id = Number(id);
		if (!app.submissions[id]) {
			app.sendMessage(message, 'Duh, you don\'t even know if it exists... or maybe, it\' already ancient...');
			return;
		}
		app.submissions[id].announceVerdict(message.channel);
	});

	router.on('!details', function(message, args) {
		let id = args[0];
		if (!id || isNaN(Number(id))) {
			app.sendMessage(message, 'So, what do you want to see? Gimme an id or something');
			return;
		}
		id = Number(id);
		if (!app.submissions[id]) {
			app.sendMessage(message, 'Duh, you don\'t even know if it exists... or maybe, it\' already ancient...');
			return;
		}
		app.submissions[id].announceVerdict(message.channel);
	});

	router.on('!problems', listProblems);

	router.on('!problem', function(message, args) {
		let id = args[0];
		if (!id) {
			app.sendMessage(message, 'So, what do you want to see? Gimme a name or something');
			return;
		}
		id = id.toUpperCase();
		if (!app.problems[id]) {
			app.sendMessage(message, 'Duh, you don\'t even know if it exists!');
			return;
		}
		app.sendMessage(message, app.problems[id].getTitle());
	});

	router.on('!download', function(message, args) {
		if (!message.channel.isPrivate) {
			app.reply(message, 'Please request this to just me :heart: and me alone :heart:');
			return;
		}
		let id = args[0];
		if (!id || isNaN(Number(id))) {
			app.reply(message, 'So, what do you want to see? Gimme an id or something');
			return;
		}
		id = Number(id);
		if (!app.submissions[id]) {
			app.reply(message, 'Duh, you don\'t even know if it exists!');
			return;
		}
		let sub = app.submissions[id];
		if (!sub.user.equals(message.author)) {
			app.reply(message, 'Uhhh... It\'s not yours :place_of_worship:');
			return;
		}
		app.reply(message, 'Here you go cutie :heart:', {
			file: {
				file: sub.file,
				name: sub.id + path.extname(sub.file)
			}
		});
	});

	router.on('!statements', function(message, args) {
		let id = args[0];
		if (!id) {
			app.sendMessage(message, 'So, what do you want to see? Gimme a name or something');
			return;
		}
		id = id.toUpperCase();
		if (!app.problems[id]) {
			app.sendMessage(message, 'Duh, you don\'t even know if it exists!');
			return;
		}
		app.sendMessage(message.author, 'Here you go cutie :heart:', {
			file: {
				file: path.join(app.problems[id].directory, 'statements.pdf'),
				name: app.problems[id].name + '.pdf'
			},
			preserveMessage: true
		});
		app.sendMessage(app.broadcastChannel, ':mailbox_with_mail:');
	});

	router.on('!mysubs', function(message) {
		let user = message.author.id;
		if (!subsBy[user] || !subsBy[user].length) {
			app.sendMessage(message, 'You have an empty cup of submissions... Why bother asking?');
			return;
		}
		app.startTyping(message);
		let mes = 'Your past submissions:\n\n';
		subsBy[user].forEach(function(id) {
			mes += ' ' + md.bold('#' + id) + ' for problem ' + md.bold(app.submissions[id].problem.name) + '\n';
		});
		app.sendMessage(message, mes);
	});

	router.on('!allsubs', function(message) {
		if (!allsubs.length) {
			app.sendMessage(message, 'Why am I so lonely? T.T');
			return;
		}
		app.startTyping(message);
		let mes = 'Most recent submissions:\n\n';
		allsubs.slice(0, Math.max(10, allsubs.length)).forEach(function(id) {
			mes += ' ' + app.submissions[id].getName() + '\n';
		});
		app.sendMessage(message, mes);
	});

	router.on('!help', function(message, args) {
		let mes = 'Available commands:\n\n';
		Object.keys(commands).forEach(function(command){
			mes += ' ' + md.inlineCode(command) + ': ' + commands[command] + '\n';
		});
		app.sendMessage(message, mes);
	});

	// Admin listeners
	router.on('!admin', function(message, args) {
		if (!app.memberHasRole(message.author, app.Config.connection.adminRole)) {
			app.sendMessage(message, 'Only @Admins can do that, sorry');
			return;
		}
		if (!args[0]) {
			app.sendMessage(message, 'Yes, you are. Happy?');
			return;
		}
		if (args[0] === 'setusername') {
			if (!args[1]) {
				app.sendMessage(message, 'Parameter missing?');
				return;
			}
			app.setUsername(args.slice(1).join(' ')).then(function() {
				app.sendMessage(message, ':ok_hand:');
			});
		}
		if (args[0] === 'setnick') {
			if (message.channel.isPrivate) {
				app.sendMessage(message, 'Use it in a server');
				return;
			}
			if (!args[1]) {
				app.sendMessage(message, 'Parameter missing?');
				return;
			}
			app.Guilds.get(message.channel.guild_id).members.find((item) => {
				return item.id === app.User.id;
			}).setNickname(message, args.slice(1).join(' ')).then(function() {
				app.sendMessage(message, ':ok_hand:');
			});
		}
		if (args[0] === 'setavatar') {
			if (!args[1]) {
				app.sendMessage(message, 'Parameter missing?');
				return;
			}
			cp.execAsync('wget "' + args[1] + '" -O /tmp/some_file').then(function(data) {
				return app.setAvatar(fs.readFileSync('/tmp/some_file'));
			}).then(function() {
				app.sendMessage(message, ':ok_hand:');
			}).catch(function(err) {
				app.sendMessage(message, 'Error' + err);
			});
		}
		if (args[0] === 'drive-download') {
			if (!args[1]) {
				app.sendMessage(message, 'Parameter missing?');
				return;
			}
			app.sendMessage(message, 'Attempting to download...');
			Drive.getFile(args[1]).then(function(stream) {
				let dlf = temp.createWriteStream();
				let file = unzip.Extract({ path: path.join(__dirname, '../problems') });
				stream.pipe(dlf);
				stream.on('error', function() {
					app.sendMessage(message, 'Can\'t download file :(');
				});
				stream.on('end', function() {
					app.sendMessage(message, 'Downloaded file! Now extracting...');
					fs.createWriteStream(dlf.path).pipe(file);
				});
				file.on('close', function() {
					app.sendMessage(message, 'Download completed!');
				});
			});
		}
		if (args[0] === 'addProblem') {
			//
		}
		if (args[0] === 'rescan') {
			scanProblems();
			app.sendMessage(message, 'Problems are being re-scanned...');
		}
	});
};

const kjudge = require('kjudge-api');
const path = require('path');
const fs = Promise.promisifyAll(require('fs'));
let Verdict = {};
(function(Verdict) {
	Verdict[Verdict['Accepted'] = 0] = 'Accepted';
	Verdict[Verdict['PartiallyCorrect'] = 1] = 'PartiallyCorrect';
	Verdict[Verdict['WrongAnswer'] = 2] = 'WrongAnswer';
	Verdict[Verdict['TimeLimitExceeded'] = 3] = 'TimeLimitExceeded';
	Verdict[Verdict['RuntimeError'] = 4] = 'RuntimeError';
	Verdict[Verdict['MemoryLimitExceeded'] = 5] = 'MemoryLimitExceeded';
	Verdict[Verdict['CompileError'] = 6] = 'CompileError';
})(Verdict);

function getVerdictDisplay(v) {
	switch (v) {
	case Verdict.Accepted:
		return ['Accepted', 'AC'];
	case Verdict.PartiallyCorrect:
		return ['Partially Correct', 'SS'];
	case Verdict.WrongAnswer:
		return ['Wrong Answer', 'WA'];
	case Verdict.TimeLimitExceeded:
		return ['Time Limit Exceeded', 'TLE'];
	case Verdict.RuntimeError:
		return ['Runtime Error', 'RTE'];
	case Verdict.MemoryLimitExceeded:
		return ['Memory Limit Exceeded', 'MLE'];
	case Verdict.CompileError:
		return ['Compile Error', 'CE'];
	default:
		throw new Error('Verdict out of range!');
	}
}
let md = require('markdown-creator');
md.inlineCode = function(text) {
	return '`' + text + '`';
};
let Runner = require('./runner');

const languagesByExt = {
	'.cpp': 'C++'
};

module.exports = function(app) {
	kjudge.Queue.Dispatcher.on('busy', () => {
		console.log('Bump!');
		app.User.setStatus('idle', { name: ' with ' + (kjudge.Queue.q.length + kjudge.Queue.con.length) + ' tests!'});
	});
	kjudge.Queue.Dispatcher.on('empty', () => {
		console.log('Bump!');
		app.User.setStatus('online', { name: ' kjudge is the future!'});
	});
	class Submission extends kjudge.Submission {
		constructor(problem, user, filepath) {
			super(++Submission.TotalCount, problem.Problem, languagesByExt[path.extname(filepath)], '');
			this.onReady = fs.readFileAsync(filepath, 'utf8').then((text) => {
				this.code = text;
			});
			this.user = user;
		}
			/**
			 * Gets the submission's status (judged, not judged)
			 * @return string
			 */
		getStatus() {
			if (this.score[0] < 0) {
				return 'Judging in process...';
			} else {
				return 'Scored ' + md.bold((Math.trunc(this.score[0] * 100) / 100).toString());
			}
		}
			/**
			 * Runs judge and builds the result array
			 * @return Promise<void>
			 */
		doJudge() {
			this.onReady.then(() => {
				return this.judge();
			}).then(() => {
				this.subtasks = [];
				let tests = this.problem.tests,
					res = this.result;
				res.forEach((item, id) => {
					while (this.subtasks.length <= tests[id].group)
						this.subtasks.push({
							score: this.score[1][this.subtasks.length],
							tests: []
						});
					item.score = item.ratio * tests[id].score;
					this.subtasks[tests[id].group].tests.push(item);
				});
			}).then(() => {
				app.sendMessage(app.broadcastChannel, this.getName() + ' has successfully been judged!')
					.then(() => {
						this.announceVerdict(app.Channels.get(app.broadcastChannel));
					});
			});
		}
		/**
		 * Names the submission
		 * @return string
		 */
		getName() {
			return 'Submission #' + md.bold(this.id.toString()) + ' by ' + this.user.mention + ' (' + this.getStatus() + ')';
		}
		/**
		 * Announces the result
		 * @param (Discordie.ITextChannel | Discordie.IDirectMessageChannel) channel The channel to broadcast to
		 * @return void
		 */
		announceVerdict(channel) {
			if (this.score[0] < 0) {
				channel.sendMessage(this.getName());
				return;
			}
			channel.sendMessage(this.getName() + '\n');
			// 20 lines per message, haizz
			let announce = (subtaskNo) => {
				if (subtaskNo >= this.subtasks.length) return Promise.resolve(0);
				let sub = this.subtasks[subtaskNo];
				let promises = [];
				for (let i = 0; i < sub.tests.length; i += 20) {
					let message = (i === 0 ? 'Subtask ' + subtaskNo + ': ' + md.bold(sub.score.toString()) + '\n' : '');
					for (let j = i; j < i + 20 && j < sub.tests.length; ++j) {
						let test = sub.tests[j];
						message += '\tTest #' + md.italic(test.testId.toString()) + ': ' + md.bold(getVerdictDisplay(test.verdict)[0]) + ' | Score: ' + md.bold((Math.trunc(test.score * 100) / 100).toString()) + ' | Running time: '
							+ md.bold(test.runningTime + 'ms')
							+ ' | Memory used: ' + md.bold(test.memoryUsed + 'KBs') + '\n';
					}
					promises.push(channel.sendMessage(message));
				}
				Promise.all(promises).then(() => {
					announce(subtaskNo + 1);
				});
			};
			announce(0);
		}
	}
	Submission.TotalCount = 0;
	return Submission;
};

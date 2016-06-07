var SUBMISSIONS_COUNT = 0;
var fs = require('fs');
var md = require('markdown-creator');
md.inlineCode = function(text) {
	return '`' + text + '`';
};
var Runner = require('./runner');

module.exports = function(app) {
	/**
	 * Class Submission
	 * @param  {User}    user    The owner of the submission
	 * @param  {Problem} problem The problem that the submission solves
	 * @property {Number} score   The score of the submission
	 * @property {String} verdict The verdict of the submission
	 * @property {Array<Object>} testcases The result of each testcase
	 */
	function Submission(user, problem, file) {
		this.id = SUBMISSIONS_COUNT;
		SUBMISSIONS_COUNT += 1;
		this.user = user;
		this.problem = problem;
		this.file = file;
		this.score = 0;
		this.verdict = null;
		this.testcases = [];
		this.isScoring = false;
		this.isScored = false;
		this.runningTime = this.memoryUsed = 0;
	}
	Submission.prototype._compile = function _compile() {
		var inst = this;
		return Runner.Compile(this.file)
					.catch(function(err) {
						inst.verdict = 'Compile Error';
						app.sendMessage(inst.user, 'Your submission cannot be compiled, here is the error:\n' + md.code(err.message));
						throw new Error('Compile Error');
					});
	};
	/**
	 * Run the specified testcase
	 * @param  {Number} number The order of the testcase
	 * @param  {Buffer} code   The code to be run
	 * @return {Promise<>}     The promise of the process
	 */
	Submission.prototype._run_testcase = function _run_testcase(number, code) {
		var inst = this;
		if (number >= this.problem.testcases.length) return Promise.resolve();
		return Runner.Evaluate({
			code: code,
			input: this.problem.testcases[number][0],
			output: this.problem.testcases[number][1],
			checker: this.problem.checker,
			timeLimit: this.problem.timeLimit,
			memoryLimit: this.problem.memoryLimit
		}).then(function(result) {
			inst.testcases.push(result);
			inst.runningTime = Math.max(inst.runningTime, result.runningTime);
			inst.memoryUsed  = Math.max(inst.memoryUsed, result.memoryUsed);
			if (inst.problem.scoreType === 'oi') {
				inst.score += (result.signal === 'AC' ? 1 : 0);
			}
			if (inst.problem.scoreType === 'acm') {
				if (result.signal !== 'AC') {
					inst.score = 0;
					inst.verdict = result.verdict + ' on test ' + (number + 1);
					return Promise.resolve();
				} else {
					inst.score += 1;
					inst.verdict = result.verdict;
				}
			}
			console.log('Case ' + (number + 1) + ' done, result: ' + result.signal);
			return inst._run_testcase(number + 1, code);
		});
	};
	/**
	 * Runs the judging system
	 * @return {Promise<>} The promise of the process
	 */
	Submission.prototype._judge = function _judge() {
		this.isScoring = true;
		app.setStatus('idle', this.getTitle());
		this.score = 0; this.testcases = []; this.verdict = null;
		this.runningTime = this.memoryUsed = 0;
		var inst = this;
		return this._compile()
				.then(function(code) {
					return inst._run_testcase(0, code);
				})
				.then(function() {
					inst.score = inst.score / inst.problem.testcases.length * inst.problem.score;
				})
				.catch(function(err) {
					console.log(err);
				})
				.finally(function() {
					inst.isScored = true;
					app.setStatus('online', null);
				});
	};
	/**
	 * Returns the full name of the submission
	 * @param  {boolean} mention Whether to mention the submission owner
	 * @return {String}          The title
	 */
	Submission.prototype.getTitle = function getTitle(mention) {
		return 'Submission #' + md.bold(this.id.toString()) + ' for problem ' + md.bold(this.problem.name) + ' by ' + (mention ? this.user : md.bold(this.user.username));
	};
	/**
	 * Returns the verdict
	 * @param  {boolean} mention Whether to mention the submission owner
	 * @return {String}          The verdict
	 */
	Submission.prototype.getVerdict = function getVerdict(mention) {
		if (!this.isScoring)
			return this.getTitle(mention) + ' is currently in queue.';
		if (!this.isScored)
			return this.getTitle(mention) + ' is currently being judged.';
		if (this.verdict !== null)
			return this.getTitle(mention) + ' has been judged with verdict ' + md.inlineCode('"' + this.verdict + '"') + '!\n Running time: ' + md.bold(this.runningTime.toString()) + 'ms | Memory used: ' + md.bold(this.memoryUsed.toString()) + 'KBs';
		else
			return this.getTitle(mention) + ' has been judged with score ' + md.bold((Math.round(this.score * 100) / 100).toString()) + '!\n Running time: ' + md.bold(this.runningTime.toString()) + 'ms | Memory used: ' + md.bold(this.memoryUsed.toString()) + 'KBs';
	};
	Submission.prototype.getFullVerdict = function getFullVerdict() {
		var message = this.getVerdict(false) + '\n';
		var testcases = '\n';
		this.testcases.forEach(function(tcase, idx) {
			testcases += ' ' + md.italic('Test ' + (idx + 1) + '') + ': ' +
						md.inlineCode(tcase.verdict) +
						' | Time: ' + md.bold(tcase.runningTime.toString()) +
						'ms | Memory: ' + md.bold(tcase.memoryUsed.toString()) +
						'KBs\n';
		});
		return message + testcases;
	};
	/**
	 * Calls the judge function
	 * @return {Promise<>} The promise of the process
	 */
	Submission.prototype.judge = function judge() {
		var inst = this;
		app.sendMessage(app.broadcastChannel, 'Judging ' + this.getTitle(true) + '...');
		return this._judge().then(function() {
			app.sendMessage(app.broadcastChannel, inst.getVerdict(true));
		});
	};
	/**
	 * Rejudges the submission
	 * @return {Promise<>} The promise of the process
	 */
	Submission.prototype.rejudge = function rejudge() {
		// this.user.score -= this.score;
		app.sendMessage(app.broadcastChannel, 'Rejudging ' + this.getTitle(true) + ', now in queue.');
		this.isScoring = this.isScored = false; this.testcases = [];
		return this;
	};

	return Submission;
};

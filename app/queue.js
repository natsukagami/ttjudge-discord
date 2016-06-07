var promise_queue = require('promise-queue');
var Queue = new promise_queue(1, Infinity);

Queue.submissions = [];

Queue.add_submission = function(submission) {
	Queue.submissions.push(submission);
	return Queue.add(function() {
		return submission.judge();
	}).finally(function() {
		Queue.submissions.shift();
	});
};

module.exports = Queue;

#!/usr/bin/env node

const scraper = require('./scraper');
const util = require('util');

(async () => {
	if(process.argv.length < 3 || !process.argv[2]) {
		console.log('Usage : node src/cli.js LINKEDIN_URL');
		return;
	}

	try {
		const result = await scraper.getCompanyOrPeopleDetails(process.argv[2]);
		var jsonContent = JSON.stringify(result);
		console.log(jsonContent);
	} catch(e) {
		console.error(e);
	}
})();

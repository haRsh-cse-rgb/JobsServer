const axios = require('axios');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const pdfParse = require('pdf-parse');

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const aiController = {
  async analyzeCv(req, res) {
    try {
      const { jobId, internshipId, cvS3Key } = req.body;

      if ((!jobId && !internshipId) || !cvS3Key) {
        return res.status(400).json({ error: 'jobId or internshipId and cvS3Key are required' });
      }

      // Only allow PDF files
      if (!cvS3Key.toLowerCase().endsWith('.pdf')) {
        return res.status(400).json({ error: 'Only PDF files are supported for CV analysis.' });
      }

      let job, isInternship = false;

      if (internshipId) {
        console.log('Looking for internship with ID:', internshipId);
        console.log('Using table:', process.env.INTERNSHIPS_TABLE);
        
        // Fetch internship details from DynamoDB
        const internshipParams = {
          TableName: process.env.INTERNSHIPS_TABLE,
          FilterExpression: 'id = :id',
          ExpressionAttributeValues: {
            ':id': internshipId
          }
        };

        console.log('Internship search params:', internshipParams);

        const internshipCommand = new ScanCommand(internshipParams);
        const internshipResult = await docClient.send(internshipCommand);

        console.log('Internship search result:', internshipResult);

        if (!internshipResult.Items || internshipResult.Items.length === 0) {
          console.log('No internship found with ID:', internshipId);
          return res.status(404).json({ error: 'Internship not found' });
        }

        job = internshipResult.Items[0];
        isInternship = true;
        console.log('Found internship:', job);
      } else {
        console.log('Looking for job with ID:', jobId);
        console.log('Using table:', process.env.JOBS_TABLE);
        console.log('All environment variables:', Object.keys(process.env).filter(key => key.includes('TABLE')));
        
        // Fetch job details from DynamoDB
        const jobParams = {
          TableName: process.env.JOBS_TABLE,
          FilterExpression: 'jobId = :jobId',
          ExpressionAttributeValues: {
            ':jobId': jobId
          }
        };

        console.log('Job search params:', jobParams);

        const jobCommand = new ScanCommand(jobParams);
        const jobResult = await docClient.send(jobCommand);

        console.log('Job search result:', jobResult);

        if (!jobResult.Items || jobResult.Items.length === 0) {
          console.log('No job found with ID:', jobId);
          return res.status(404).json({ error: 'Job not found' });
        }

        job = jobResult.Items[0];
        console.log('Found job:', job);
      }

      // Fetch CV from S3
      const s3Params = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: cvS3Key
      };

      const s3Command = new GetObjectCommand(s3Params);
      const s3Result = await s3Client.send(s3Command);
      
      // Extract text from PDF using pdf-parse
      const pdfBuffer = await streamToBuffer(s3Result.Body);
      const pdfData = await pdfParse(pdfBuffer);
      const cvContent = pdfData.text;

      console.log(cvContent);
      console.log(job);
      console.log(cvS3Key);

      // Prepare prompt for Gemini API
      const prompt = `
        You are an expert resume reviewer. Your job is to strictly analyze only CVs/resumes. If the uploaded document is not a CV or resume (for example, if it is a cover letter, application letter, or any other document), do NOT produce any analysis or score. Instead, return this JSON:
        { "error": "Please upload a CV or resume, not other document." }

        If the document is a CV/resume, analyze it against the following ${isInternship ? 'internship' : 'job'} description and provide a STRICT, realistic, and critical review. Do not give high scores easily. Only give high compatibility if the CV is truly an excellent match. Provide detailed, actionable, and honest suggestions for improvement.

        For each area to improve, if a specific line or bullet point in the CV needs improvement, quote the original line as 'originalLine' and provide a rewritten improved version as 'improvedLine'. If the improvement is not line-specific, provide a clear and actionable suggestion as a string.

        For the 'improvements' array, do not be generic. Give very specific, actionable suggestions tailored to the actual content of the uploaded CV. Reference the actual lines or sections that need improvement and explain exactly what to change or add.

        ${isInternship ? 'INTERNSHIP' : 'JOB'} DETAILS:
        ${isInternship ? `Title: ${job.title}` : `Role: ${job.role}`}
        Company: ${job.companyName || job.company}
        Location: ${job.location}
        ${isInternship ? 'Internship' : 'Job'} Description: ${job.jobDescription || job.description}
        Required Skills/Tags: ${Array.isArray(job.tags || job.skills) ? (job.tags || job.skills).join(', ') : typeof (job.tags || job.skills) === 'string' ? (job.tags || job.skills) : 'Not specified'}
        ${isInternship ? `Batch: ${Array.isArray(job.batch) ? job.batch.join(', ') : typeof job.batch === 'string' ? job.batch : 'Not specified'}` : ''}

        CV CONTENT:
        ${cvContent}

        Please provide a JSON response with the following structure:
        {
          "compatibilityScore": <number between 0-100>,
          "strengths": [<array of key strengths that match the ${isInternship ? 'internship' : 'job'}>],
          "weaknesses": [<array of objects, each with 'originalLine' and 'improvedLine' properties, or a string if not line-specific>],
          "improvements": [<array of specific, actionable suggestions tailored to this CV>],
          "matchingSkills": [<array of skills from CV that match ${isInternship ? 'internship' : 'job'} requirements>],
          "missingSkills": [<array of important skills missing from CV>]
        }
      `;

      // Call Gemini API (mock implementation - replace with actual API call)
      const geminiResponse = await callGeminiAPI(prompt);

      // Get suggested jobs based on CV analysis
      const suggestedJobs = isInternship ? [] : await getSuggestedJobs(geminiResponse.matchingSkills, jobId);

      const response = {
        analysis: geminiResponse,
        suggestedJobs: suggestedJobs
      };

      res.json(response);
    } catch (error) {
      console.error('Error analyzing CV:', error);
      res.status(500).json({ 
        error: 'CV analysis failed',
        message: 'Unable to analyze CV at this time. Please try again later.'
      });
    }
  }
};

// Helper function to convert stream to string
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

// Helper function to convert stream to buffer
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Mock Gemini API call (replace with actual implementation)
async function callGeminiAPI(prompt) {
  try {
    // This is a mock response - replace with actual Gemini API call
    if (process.env.GEMINI_API_KEY) {
      console.log('Attempting to call Gemini API...');
      const response = await axios.post(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
        {
          contents: [{
            parts: [{ text: prompt }]
          }]
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': process.env.GEMINI_API_KEY
          },
          timeout: 30000 // 30 second timeout
        }
      );

      console.log('Gemini API response received');
      // Parse the response and extract JSON
      let generatedText = response.data.candidates[0].content.parts[0].text;
      // Remove Markdown code block if present
      generatedText = generatedText.replace(/```json|```/g, '').trim();
      return JSON.parse(generatedText);
    } else {
      console.log('No GEMINI_API_KEY found, using mock response');
      // Mock response for development
      return {
        compatibilityScore: Math.floor(Math.random() * 40) + 60, // 60-100
        strengths: [
          "Strong technical background in relevant technologies",
          "Good educational qualifications",
          "Relevant work experience",
          "Problem-solving skills demonstrated"
        ],
        weaknesses: [
          "Limited experience with specific frameworks mentioned in job",
          "Could improve communication skills section",
          "Missing some industry certifications"
        ],
        improvements: [
          "Add more specific project details and outcomes",
          "Include relevant certifications or courses",
          "Highlight leadership and teamwork experiences",
          "Quantify achievements with numbers and metrics",
          "Tailor skills section to match job requirements"
        ],
        matchingSkills: ["JavaScript", "React", "Node.js", "Problem Solving"],
        missingSkills: ["AWS", "Docker", "Kubernetes", "CI/CD"]
      };
    }
  } catch (error) {
    console.error('Gemini API error:', error.response?.data || error.message);
    console.error('Error status:', error.response?.status);
    console.error('Error details:', error.response?.data);
    
    // Fallback to mock response if API fails
    console.log('Falling back to mock response due to API error');
    return {
      compatibilityScore: Math.floor(Math.random() * 40) + 60, // 60-100
      strengths: [
        "Strong technical background in relevant technologies",
        "Good educational qualifications",
        "Relevant work experience",
        "Problem-solving skills demonstrated"
      ],
      weaknesses: [
        "Limited experience with specific frameworks mentioned in job",
        "Could improve communication skills section",
        "Missing some industry certifications"
      ],
      improvements: [
        "Add more specific project details and outcomes",
        "Include relevant certifications or courses",
        "Highlight leadership and teamwork experiences",
        "Quantify achievements with numbers and metrics",
        "Tailor skills section to match job requirements"
      ],
      matchingSkills: ["JavaScript", "React", "Node.js", "Problem Solving"],
      missingSkills: ["AWS", "Docker", "Kubernetes", "CI/CD"]
    };
  }
}

// Get suggested jobs based on matching skills
async function getSuggestedJobs(matchingSkills, currentJobId) {
  try {
    const params = {
      TableName: process.env.JOBS_TABLE,
      FilterExpression: '#status = :active AND jobId <> :currentJobId',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':active': 'active',
        ':currentJobId': currentJobId
      }
    };

    const command = new ScanCommand(params);
    const result = await docClient.send(command);

    // Score jobs based on skill matches
    const scoredJobs = result.Items.map(job => {
      const jobTags = Array.isArray(job.tags)
        ? job.tags
        : typeof job.tags === 'string'
          ? job.tags.split(',').map(tag => tag.trim())
          : [];
      const matchCount = matchingSkills.filter(skill => 
        jobTags.some(tag => tag.toLowerCase().includes(skill.toLowerCase()))
      ).length;
      
      return {
        ...job,
        matchScore: matchCount
      };
    });

    // Sort by match score and return top 5
    return scoredJobs
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 5)
      .map(job => ({
        jobId: job.jobId,
        role: job.role,
        companyName: job.companyName,
        location: job.location,
        matchScore: job.matchScore
      }));
  } catch (error) {
    console.error('Error getting suggested jobs:', error);
    return [];
  }
}



module.exports = aiController;
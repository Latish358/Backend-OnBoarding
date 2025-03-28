const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// MySQL Connection
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'root', 
    database: 'employee_onboarding'
});

db.connect(err => {
    if (err) throw err;
    console.log('MySQL Connected...');
});

// Multer setup for file uploads
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const upload = multer({ storage });

// Create uploads directory if it doesn't exist
const fs = require('fs');
if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}

// API Endpoint to handle form submission
app.post('/api/submit-onboarding', upload.any(), (req, res) => {
    const employeeData = req.body;
    const files = req.files;

    // Prepare data for database
    const personalInfo = {
        full_name: employeeData.fullName,
        email: employeeData.email,
        phone_no: employeeData.phoneNo,
        alternate_number: employeeData.alternateNumber,
        guardian_name: employeeData.guardianName,
        guardian_contact: employeeData.guardianContact,
        marital_status: employeeData.maritalStatus,
        gender: employeeData.gender,
        blood_group: employeeData.bloodGroup,
        date_of_birth: employeeData.dateOfBirth
    };

    const govIds = {
        aadhar_no: employeeData.aadharNo,
        aadhar_file: files.find(f => f.fieldname === 'aadhaarFile')?.path || null,
        pan_no: employeeData.panNo,
        pan_file: files.find(f => f.fieldname === 'panFile')?.path || null
    };

    const prevEmployment = {
        pf_no: employeeData.pfNo || null,
        uan_no: employeeData.uanNo || null
    };

    const address = {
        current_address: employeeData.currentAddress,
        current_city: employeeData.currentCity,
        current_state: employeeData.currentState,
        current_pincode: employeeData.currentPincode,
        permanent_address: employeeData.permanentAddress,
        permanent_city: employeeData.permanentCity,
        permanent_state: employeeData.permanentState,
        permanent_pincode: employeeData.permanentPincode
    };

    const bankDetails = {
        bank_name: employeeData.bankNameAsPerForm,
        account_no: employeeData.accountNo,
        ifsc_code: employeeData.ifscCode,
        branch_name: employeeData.branchName
    };

    // Start transaction
    db.beginTransaction(err => {
        if (err) return res.status(500).json({ error: 'Transaction Error' });

        // Insert Personal Info
        db.query('INSERT INTO employees SET ?', personalInfo, (err, result) => {
            if (err) {
                db.rollback();
                return res.status(500).json({ error: 'Error inserting personal info' });
            }

            const employeeId = result.insertId;

            // Insert Government IDs
            govIds.employee_id = employeeId;
            db.query('INSERT INTO government_ids SET ?', govIds, err => {
                if (err) {
                    db.rollback();
                    return res.status(500).json({ error: 'Error inserting government IDs' });
                }

                // Insert Previous Employment
                prevEmployment.employee_id = employeeId;
                db.query('INSERT INTO previous_employment SET ?', prevEmployment, err => {
                    if (err) {
                        db.rollback();
                        return res.status(500).json({ error: 'Error inserting previous employment' });
                    }

                    // Insert Address
                    address.employee_id = employeeId;
                    db.query('INSERT INTO addresses SET ?', address, err => {
                        if (err) {
                            db.rollback();
                            return res.status(500).json({ error: 'Error inserting address' });
                        }

                        // Insert Bank Details
                        bankDetails.employee_id = employeeId;
                        db.query('INSERT INTO bank_details SET ?', bankDetails, err => {
                            if (err) {
                                db.rollback();
                                return res.status(500).json({ error: 'Error inserting bank details' });
                            }

                            // Insert Education Details
                            const educationDetails = JSON.parse(employeeData.educationDetails);
                            const educationQueries = educationDetails.map((edu, index) => {
                                const eduData = {
                                    employee_id: employeeId,
                                    level: edu.level,
                                    stream: edu.stream,
                                    institution: edu.institution,
                                    year: edu.year,
                                    score: edu.score,
                                    doc_path: files.find(f => f.fieldname === `education[${index}][doc]`)?.path || null
                                };
                                return new Promise((resolve, reject) => {
                                    db.query('INSERT INTO education SET ?', eduData, (err) => {
                                        if (err) reject(err);
                                        else resolve();
                                    });
                                });
                            });

                            Promise.all(educationQueries)
                                .then(() => {
                                    // Insert Employment Details
                                    const employmentDetails = JSON.parse(employeeData.employmentDetails);
                                    const employmentQueries = employmentDetails.map((emp, index) => {
                                        const empData = {
                                            employee_id: employeeId,
                                            company_name: emp.companyName,
                                            designation: emp.designation,
                                            last_project: emp.lastProject,
                                            start_date: emp.companyStartDate,
                                            end_date: emp.companyEndDate,
                                            doc_path: files.find(f => f.fieldname === `employmentDoc${index + 1}`)?.path || null
                                        };
                                        return new Promise((resolve, reject) => {
                                            db.query('INSERT INTO employment_history SET ?', empData, (err) => {
                                                if (err) reject(err);
                                                else resolve();
                                            });
                                        });
                                    });

                                    Promise.all(employmentQueries)
                                        .then(() => {
                                            // Insert Signature
                                            const signatureData = {
                                                employee_id: employeeId,
                                                signature_file: files.find(f => f.fieldname === 'signatureFile')?.path || null,
                                                consent: employeeData.consentCheckbox === 'on' ? 1 : 0
                                            };
                                            db.query('INSERT INTO signatures SET ?', signatureData, err => {
                                                if (err) {
                                                    db.rollback();
                                                    return res.status(500).json({ error: 'Error inserting signature' });
                                                }

                                                db.commit(err => {
                                                    if (err) {
                                                        db.rollback();
                                                        return res.status(500).json({ error: 'Commit Error' });
                                                    }
                                                    res.status(200).json({ message: 'Form submitted successfully' });
                                                });
                                            });
                                        })
                                        .catch(err => {
                                            db.rollback();
                                            res.status(500).json({ error: 'Error inserting employment details' });
                                        });
                                })
                                .catch(err => {
                                    db.rollback();
                                    res.status(500).json({ error: 'Error inserting education details' });
                                });
                        });
                    });
                });
            });
        });
    });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
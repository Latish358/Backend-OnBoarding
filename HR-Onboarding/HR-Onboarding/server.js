const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// MySQL Connection
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'root', // Replace with your actual password
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

const fs = require('fs');
if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}

// Serve uploaded files statically
app.use('/uploads', express.static('uploads'));

// Existing POST endpoint (unchanged)
app.post('/api/submit-onboarding', upload.fields([
    { name: 'aadhaarFile', maxCount: 1 },
    { name: 'panFile', maxCount: 1 },
    { name: 'signatureFile', maxCount: 1 },
    { name: 'education[0][doc]', maxCount: 1 },
    { name: 'employmentDoc1', maxCount: 1 }
]), (req, res) => {
    const employeeData = req.body;
    const files = req.files;

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
        aadhar_file: files['aadhaarFile'] ? files['aadhaarFile'][0].path : null,
        pan_no: employeeData.panNo,
        pan_file: files['panFile'] ? files['panFile'][0].path : null
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

    db.beginTransaction(err => {
        if (err) return res.status(500).json({ error: 'Transaction Error' });

        db.query('INSERT INTO employees SET ?', personalInfo, (err, result) => {
            if (err) {
                db.rollback();
                return res.status(500).json({ error: 'Error inserting personal info' });
            }

            const employeeId = result.insertId;

            govIds.employee_id = employeeId;
            db.query('INSERT INTO government_ids SET ?', govIds, err => {
                if (err) {
                    db.rollback();
                    return res.status(500).json({ error: 'Error inserting government IDs' });
                }

                prevEmployment.employee_id = employeeId;
                db.query('INSERT INTO previous_employment SET ?', prevEmployment, err => {
                    if (err) {
                        db.rollback();
                        return res.status(500).json({ error: 'Error inserting previous employment' });
                    }

                    address.employee_id = employeeId;
                    db.query('INSERT INTO addresses SET ?', address, err => {
                        if (err) {
                            db.rollback();
                            return res.status(500).json({ error: 'Error inserting address' });
                        }

                        bankDetails.employee_id = employeeId;
                        db.query('INSERT INTO bank_details SET ?', bankDetails, err => {
                            if (err) {
                                db.rollback();
                                return res.status(500).json({ error: 'Error inserting bank details' });
                            }

                            const educationDetails = JSON.parse(employeeData.educationDetails);
                            const educationQueries = educationDetails.map(edu => {
                                const eduData = {
                                    employee_id: employeeId,
                                    level: edu.level,
                                    stream: edu.stream,
                                    institution: edu.institution,
                                    year: edu.year,
                                    score: edu.score,
                                    doc_path: files[`education[0][doc]`] ? files[`education[0][doc]`][0].path : null
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
                                    const employmentDetails = JSON.parse(employeeData.employmentDetails);
                                    const employmentQueries = employmentDetails.map(emp => {
                                        const empData = {
                                            employee_id: employeeId,
                                            company_name: emp.companyName,
                                            designation: emp.designation,
                                            last_project: emp.lastProject,
                                            start_date: emp.companyStartDate,
                                            end_date: emp.companyEndDate,
                                            doc_path: files[`employmentDoc1`] ? files[`employmentDoc1`][0].path : null
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
                                            const signatureData = {
                                                employee_id: employeeId,
                                                signature_file: files['signatureFile'] ? files['signatureFile'][0].path : null,
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
                                                    res.status(200).json({ message: 'Form submitted successfully', employeeId });
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

// New GET endpoint to fetch all employees
app.get('/api/employees', (req, res) => {
    const query = `
        SELECT 
            e.id, e.full_name, e.email, e.phone_no, e.alternate_number, e.guardian_name, 
            e.guardian_contact, e.marital_status, e.gender, e.blood_group, e.date_of_birth,
            g.aadhar_no, g.aadhar_file, g.pan_no, g.pan_file, 
            p.pf_no, p.uan_no,
            a.current_address, a.current_city, a.current_state, a.current_pincode,
            a.permanent_address, a.permanent_city, a.permanent_state, a.permanent_pincode,
            b.bank_name, b.account_no, b.ifsc_code, b.branch_name,
            s.signature_file, s.consent, s.status
        FROM employees e
        LEFT JOIN government_ids g ON e.id = g.employee_id
        LEFT JOIN previous_employment p ON e.id = p.employee_id
        LEFT JOIN addresses a ON e.id = a.employee_id
        LEFT JOIN bank_details b ON e.id = b.employee_id
        LEFT JOIN signatures s ON e.id = s.employee_id
    `;

    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: 'Database query error' });

        const employees = results.map(employee => ({
            id: employee.id,
            fullName: employee.full_name,
            email: employee.email,
            phoneNo: employee.phone_no,
            alternateNumber: employee.alternate_number,
            guardianName: employee.guardian_name,
            guardianContact: employee.guardian_contact,
            maritalStatus: employee.marital_status,
            gender: employee.gender,
            bloodGroup: employee.blood_group,
            dateOfBirth: employee.date_of_birth,
            aadharNo: employee.aadhar_no,
            aadharFile: employee.aadhar_file ? `/uploads/${path.basename(employee.aadhar_file)}` : null,
            panNo: employee.pan_no,
            panFile: employee.pan_file ? `/uploads/${path.basename(employee.pan_file)}` : null,
            pfNo: employee.pf_no,
            uanNo: employee.uan_no,
            currentAddress: employee.current_address,
            currentCity: employee.current_city,
            currentState: employee.current_state,
            currentPincode: employee.current_pincode,
            permanentAddress: employee.permanent_address,
            permanentCity: employee.permanent_city,
            permanentState: employee.permanent_state,
            permanentPincode: employee.permanent_pincode,
            bankNameAsPerForm: employee.bank_name,
            accountNo: employee.account_no,
            ifscCode: employee.ifsc_code,
            branchName: employee.branch_name,
            signature: employee.signature_file ? `/uploads/${path.basename(employee.signature_file)}` : null,
            consent: employee.consent,
            status: employee.status || 'pending'
        }));

        // Fetch education and employment details separately
        Promise.all([
            new Promise((resolve, reject) => {
                db.query('SELECT * FROM education', (err, results) => {
                    if (err) reject(err);
                    else resolve(results);
                });
            }),
            new Promise((resolve, reject) => {
                db.query('SELECT * FROM employment_history', (err, results) => {
                    if (err) reject(err);
                    else resolve(results);
                });
            })
        ])
        .then(([educationResults, employmentResults]) => {
            employees.forEach(employee => {
                employee.educationDetails = educationResults
                    .filter(edu => edu.employee_id === employee.id)
                    .map(edu => ({
                        level: edu.level,
                        stream: edu.stream,
                        institution: edu.institution,
                        year: edu.year,
                        score: edu.score,
                        doc: edu.doc_path ? `/uploads/${path.basename(edu.doc_path)}` : null
                    }));

                employee.employmentDetails = employmentResults
                    .filter(emp => emp.employee_id === employee.id)
                    .map(emp => ({
                        companyName: emp.company_name,
                        designation: emp.designation,
                        lastProject: emp.last_project,
                        companyStartDate: emp.start_date,
                        companyEndDate: emp.end_date,
                        doc: emp.doc_path ? `/uploads/${path.basename(emp.doc_path)}` : null
                    }));
            });
            res.json(employees);
        })
        .catch(err => res.status(500).json({ error: 'Error fetching details' }));
    });
});

// Update employee status
app.put('/api/employees/:id/status', (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    db.query(
        'UPDATE signatures SET status = ? WHERE employee_id = ?',
        [status, id],
        (err) => {
            if (err) return res.status(500).json({ error: 'Error updating status' });
            res.json({ message: 'Status updated successfully' });
        }
    );
});

// Delete all employees
app.delete('/api/employees', (req, res) => {
    db.beginTransaction(err => {
        if (err) return res.status(500).json({ error: 'Transaction Error' });

        const tables = ['signatures', 'employment_history', 'education', 'bank_details', 'addresses', 'previous_employment', 'government_ids', 'employees'];
        const deleteQueries = tables.map(table => {
            return new Promise((resolve, reject) => {
                db.query(`DELETE FROM ${table}`, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });

        Promise.all(deleteQueries)
            .then(() => {
                db.commit(err => {
                    if (err) {
                        db.rollback();
                        return res.status(500).json({ error: 'Commit Error' });
                    }
                    res.json({ message: 'All records cleared successfully' });
                });
            })
            .catch(err => {
                db.rollback();
                res.status(500).json({ error: 'Error clearing records' });
            });
    });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
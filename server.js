const express = require('express');
const mysql = require('mysql2');
const multer = require('multer');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const ExcelJS = require('exceljs');
// DYNAMIC PORT CONFIGURATION
// Heroku will "inject" a port number into process.env.PORT
const PORT = process.env.PORT;

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.json());
app.use('/uploads', express.static('uploads')); // Serve uploaded files
app.use(express.static('public')); // This line make image used inside the html file to be loaded correctly and inside html we use <img src="/IMG-20251028-WA0008.jpg" alt="RICA lOGO"> instead of src="./img(Folder which holder image)/your-image.jpg"

// DATABASE CONNECTION CONFIGURATION
// We use 'process.env' so your password isn't visible on GitHub
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: 3306,
    // Tip: Add this to handle connection drops
    connectTimeout: 10000 
});

db.connect((err) => {
    if (err) {
        console.error('Error connecting to Alwaysdata MySQL:', err.message);
        return;
    }
    console.log('Connected to Alwaysdata MySQL database.');
});

// Setup File Upload Storage
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Search Contract
app.get('/api/search/:number', (req, res) => {
    const sql = "SELECT * FROM contracts WHERE contract_name = ?";
    db.query(sql, [req.params.number], (err, result) => {
        if (err) return res.status(500).send(err);
        res.json(result);
    });
});

// Add Payment
app.post('/api/payments', upload.single('attachment'), (req, res) => {
    const { contract_id, payment_method, amount, due_date } = req.body;
    const attachment_path = req.file ? req.file.filename : null;

    const sql = "INSERT INTO payments (contract_id, payment_method, amount, due_date, attachment_path) VALUES (?, ?, ?, ?, ?)";
    db.query(sql, [contract_id, payment_method, amount, due_date, attachment_path], (err, result) => {
        if (err) return res.status(500).send(err);
        res.send({ message: "Payment added successfully!" });
    });
});

// Get All Payments for a Contract
app.get('/api/payments/:contract_id', (req, res) => {
    const sql = "SELECT * FROM payments WHERE contract_id = ?";
    db.query(sql, [req.params.contract_id], (err, result) => {
        if (err) return res.status(500).send(err);
        res.json(result);
    });
});

db.connect(err => {
    if (err) console.log('DB Connection Failed: ' + err.message);
    else console.log('MySQL Connected...');
});

// Login (Plain Text Password Check)
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const sql = 'SELECT * FROM users WHERE username = ?';
    
    db.query(sql, [username], (err, results) => {
        if (err) return res.status(500).send(err);
        if (results.length === 0) return res.status(400).send('User not found');

        const user = results[0];
        
        // DIRECT COMPARISON (No Hashing)
        if (password !== user.password) {
            return res.status(400).send('Invalid Password');
        }

        // Return user info
        res.json({
            id: user.id,
            username: user.username,
            role: user.role,
            name: user.name
        });
    });
});



// GET ALL CONTRACTS
app.get('/api/contracts', (req, res) => {
    db.query('SELECT * FROM contracts ORDER BY id ASC', (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

// GET SINGLE CONTRACT BY ID (INTEGRATED FOR RENEWAL CLONING)
app.get('/api/contracts/id/:id', (req, res) => {
    db.query("SELECT * FROM contracts WHERE id = ?", [req.params.id], (err, results) => {
        if (err) return res.status(500).json({success: false, err});
        if (results.length > 0) res.json({ success: true, contract: results[0] });
        else res.json({ success: false, message: 'Not found' });
    });
});


app.post('/api/contracts', (req, res) => {
    const data = req.body;
    
    // Prepare Contract Data (Step 1 Fields)
    const contractData = {
        contract_name: data.contract_name,
        contract_number: data.contract_nber,
        contract_type: data.contract_type,
        service_provider: data.service_provider,
        service_provider_phone: data.service_provider_phone,
        service_provider_email: data.service_provider_email,
        tender_type: data.tender_type,
        contract_manager: data.manager_name,
        manager_phone: data.manager_phone,
        manager_email: data.manager_email,
        start_date: data.start_date,
        end_date: data.end_date,
        budget_source: data.budget_source,

        // Otherwise, they are saved as null to keep the database clean.
        partner_name: data.budget_source === 'Development Partner' ? data.partner_name : null,
        project_name: data.budget_source === 'Development Partner' ? data.project_name : null,

        budget_allocated: data.budget_allocated,
        contract_value: data.contract_value,
        status: data.renewed_from_id ? 'Active' : 'Pending',
        renewed_from_id: data.renewed_from_id || null
    };

    const sqlContract = 'INSERT INTO contracts SET ?';

    // Insert the Contract first
    db.query(sqlContract, contractData, (err, result) => {
        if (err) {
            //CRITICAL DEBUGGING LOGS
            console.error("--- SQL CONTRACT INSERTION FAILED ---");
            console.error("SQL Error Code:", err.code);
            console.error("SQL Error Message:", err.message); 
            console.log("Data Payload Sent to DB:", contractData);
            console.error("--------------------------------------");
            
            return res.status(500).json({ 
                error: "Failed to insert contract data", 
                details: err.message 
            });
        }

        // Capture the new Contract ID
        const newContractId = result.insertId;
        
        // Parse Activities Data
        let activities = [];
        try {
            if (data.activities) {
                activities = typeof data.activities === 'string' ? JSON.parse(data.activities) : data.activities;
            }
        } catch (e) {
            console.error("Error parsing activities JSON", e);
        }

        if (activities.length > 0) {
            // Prepare Activities for Bulk Insert
            const activityValues = activities.map(act => [
                newContractId, 
                act.name,
                act.timeline,
                act.cost,
                act.deliverable
            ]);

            const sqlActivities = 'INSERT INTO activities (contract_id, activity_name, timeline, cost, deliverable) VALUES ?';
            
            // Insert Activities
            db.query(sqlActivities, [activityValues], (err, result) => {
                if (err) {
                    console.error("Error inserting activities:", err);
                    return res.status(500).json({ error: "Contract saved but activities insertion failed.", contractId: newContractId });
                }
                res.json({ message: 'Contract and Activities Saved Successfully', contractId: newContractId });
            });
        } else {
            res.json({ message: 'Contract Saved Successfully (No activities)', contractId: newContractId });
        }
    });
});

// Get Contracts (for Dashboard view)
// DESC "To arrange by Descending Order (Newest First)"
// ASC "To arrange by Ascending Order (Oldest First)"
// app.get('/api/contracts', (req, res) => {
//     db.query('SELECT * FROM contracts ORDER BY id ASC', (err, results) => {
//         if (err) return res.status(500).send(err);
//         res.json(results);
//     });
// });

// Register User (Plain Text Password Storage)
app.post('/api/users/create', (req, res) => {
    const { username, password, role, name, email, creatorRole } = req.body;

    // Security Check
    if (creatorRole !== 'master_admin') {
        return res.status(403).send('Access Denied: Only Master Admin can create users.');
    }

    // DIRECT INSERT (No Hashing)
    const sql = 'INSERT INTO users (username, password, role, name, email) VALUES (?, ?, ?, ?, ?)';
    db.query(sql, [username, password, role, name, email], (err, result) => {
        if (err) return res.status(500).send(err);
        res.send('User created successfully');
    });
});

// Delete User
app.delete('/api/users/:id', (req, res) => {
    const { creatorRole } = req.body;
    if (creatorRole !== 'master_admin') return res.status(403).send('Access Denied');

    const sql = 'DELETE FROM users WHERE id = ?';
    db.query(sql, [req.params.id], (err, result) => {
        if (err) return res.status(500).send(err);
        res.send('User deleted');
    });
});

// CONTRACT ROUTES
app.get('/api/contracts', (req, res) => {
    db.query('SELECT * FROM contracts', (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

app.post('/api/contracts', (req, res) => {
    const data = req.body;
    const sql = 'INSERT INTO contracts SET ?';
    db.query(sql, data, (err, result) => {
        if (err) return res.status(500).send(err);
        res.send('Contract added');
    });
});

// Search Contract by Name
app.get('/api/contracts/search', (req, res) => {
    const name = req.query.name;
    const sql = "SELECT * FROM contracts WHERE contract_name LIKE ? LIMIT 1";
    db.query(sql, [`%${name}%`], (err, results) => {
        if (err) return res.status(500).send({ error: 'Search failed' });
        res.json(results);
    });
});

// Get Activities for a specific Contract ID
app.get('/api/activities/:contractId', (req, res) => {
    const contractId = req.params.contractId;
    // Retrieves all associated activities for the given contract ID
    const sql = "SELECT * FROM activities WHERE contract_id = ?";
    db.query(sql, [contractId], (err, results) => {
        if (err) return res.status(500).send({ error: 'Failed to retrieve activities' });
        res.json(results);
    });
});

// Update Activity Status
app.put('/api/activities/:id/status', (req, res) => {
    const activityId = req.params.id;
    const { status } = req.body; // Expected body: { "status": "Completed" }
    
    // Basic validation to prevent invalid status values
    if (!['Pending', 'Failed', 'Completed'].includes(status)) {
        return res.status(400).send({ error: 'Invalid status value' });
    }

    const sql = "UPDATE activities SET status = ? WHERE id = ?";
    db.query(sql, [status, activityId], (err, result) => {
        if (err) return res.status(500).send({ error: 'Failed to update status' });
        if (result.affectedRows === 0) return res.status(404).send({ error: 'Activity not found' });
        res.send({ message: 'Status updated successfully' });
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Evaluation Endpoint
// Updated Evaluation Route to handle Name Search
app.get('/api/evaluate/:name', (req, res) => {
    const name = req.params.name;

    // This SQL finds the contract by name and joins all its activities
    const sql = `
        SELECT c.id, c.contract_name, c.contract_number, a.* FROM contracts c
        LEFT JOIN activities a ON c.id = a.contract_id
        WHERE c.contract_name LIKE ? AND c.is_archived = 0`;

    db.query(sql, [`%${name}%`], (err, results) => {
        if (err) return res.status(500).json({ success: false, error: err });
        
        if (results.length === 0) {
            return res.json({ success: false, message: "Contract not found" });
        }

        // Format data: results might contain multiple rows (one for each activity)
        const contractData = {
            success: true,
            contract_name: results[0].contract_name,
            activities: results[0].activity_name ? results : [] // Check if activities exist
        };

        res.json(contractData);
    });
});

// Serve the HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Beginning of Archive Section Embeded
// Get Archived Lists
// ARCHIVED LIST GETTER
app.get('/api/contracts/archived', (req, res) => {
    const archivedSql = "SELECT * FROM contracts WHERE is_archived = 1 ORDER BY archive_date DESC";
    const activeCountSql = "SELECT COUNT(*) as activeCount FROM contracts WHERE is_archived = 0";

    db.query(archivedSql, (err, archived) => {
        if (err) return res.status(500).json(err);
        db.query(activeCountSql, (err, countRes) => {
            res.json({ archived: archived, activeCount: countRes[0].activeCount });
        });
    });
});

// Search for active
app.get('/api/contracts/search-active', (req, res) => {
    const num = req.query.num;
    const sql = `SELECT id, contract_number, contract_name, service_provider 
                 FROM contracts WHERE contract_name = ? AND is_archived = 0`;
    db.query(sql, [num], (err, results) => {
        if (err) return res.status(500).json(err);
        if (results.length > 0) res.json({ success: true, contract: results[0] });
        else res.json({ success: false });
    });
});
// End of Archive Section Embeded

// Search Contract
app.get('/api/contracts/:num', (req, res) => {
    const sql = "SELECT * FROM contracts WHERE contract_name = ?";
    db.query(sql, [req.params.num], (err, results) => {
        if (results && results.length > 0) {
            res.json({ success: true, contract: results[0] });
        } else {
            res.json({ success: false });
        }
    });
});

// Post New Issue
app.post('/api/issues', (req, res) => {
    const { contract_id, title, description, priority, reported_date } = req.body;
    const sql = "INSERT INTO issues (contract_id, title, description, priority, reported_date) VALUES (?, ?, ?, ?, ?)";
    db.query(sql, [contract_id, title, description, priority, reported_date], (err) => {
        if (err) return res.status(500).send(err);
        res.sendStatus(200);
    });
});

// Get Issues for a Contract
app.get('/api/issues/:contractId', (req, res) => {
    const sql = "SELECT * FROM issues WHERE contract_id = ? ORDER BY reported_date DESC";
    db.query(sql, [req.params.contractId], (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

// API Route to get contract stats
app.get('/api/contract-stats', (req, res) => {
    // Single query to get all counts
    const sql = `
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
        FROM contracts
    `;

    db.query(sql, (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results[0]);
    });
});

// Beginning of the user management 
// Get all users (Read)
app.get('/api/users', (req, res) => {
    const query = 'SELECT id, username, name, email, role, created_at FROM users ORDER BY id DESC';
    db.query(query, (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(results);
    });
});

// Get a single user by ID (Read specifically for View/Update)
app.get('/api/users/:id', (req, res) => {
    const userId = req.params.id;
    // We select password here so it can be loaded into the edit form if needed
    const query = 'SELECT * FROM users WHERE id = ?';
    db.query(query, [userId], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Database error' });
        }
        if (results.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(results[0]);
    });
});

// Add new user (Create)
app.post('/api/users', (req, res) => {
    const { username, password, name, email, role } = req.body;
    // Note: Storing password as plain text based on your DB image constraint. 
    // In production, hash passwords first!
    const query = 'INSERT INTO users (username, password, name, email, role, created_at) VALUES (?, ?, ?, ?, ?, NOW())';
    
    db.query(query, [username, password, name, email, role], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Failed to add user' });
        }
        res.json({ message: 'User added successfully', id: result.insertId });
    });
});

// Update user (Update)
app.put('/api/users/:id', (req, res) => {
    const userId = req.params.id;
    const { username, password, name, email, role } = req.body;
    
    const query = 'UPDATE users SET username=?, password=?, name=?, email=?, role=? WHERE id=?';
    
    db.query(query, [username, password, name, email, role, userId], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Failed to update user' });
        }
        res.json({ message: 'User updated successfully' });
    });
});

// Delete user (Delete)
app.delete('/api/users/:id', (req, res) => {
    const userId = req.params.id;
    const query = 'DELETE FROM users WHERE id=?';
    
    db.query(query, [userId], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Failed to delete user' });
        }
        res.json({ message: 'User deleted successfully' });
    });
});

// Beginning of setting code for user
// Change password for logged-in user
app.put('/api/users/change-password/:id', (req, res) => {
    const userId = req.params.id;
    const { currentPassword, newPassword } = req.body;

    //Verify current password
    const checkQuery = 'SELECT password FROM users WHERE id = ?';
    db.query(checkQuery, [userId], (err, results) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (results.length === 0) return res.status(404).json({ error: 'User not found' });

        if (results[0].password !== currentPassword) {
            return res.status(401).json({ error: 'The current password you entered is incorrect.' });
        }

        //Update to new password
        const updateQuery = 'UPDATE users SET password = ? WHERE id = ?';
        db.query(updateQuery, [newPassword, userId], (err, result) => {
            if (err) return res.status(500).json({ error: 'Update failed' });
            res.json({ message: 'Success! Your password has been changed.' });
        });
    });
});

// Beginning of Amendament
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// API to get list of contracts for the dropdown
app.get('/api/contracts', (req, res) => {
    // We select 'id' and 'contract_name' as seen in your screenshot
    const query = 'SELECT id, contract_name FROM contracts'; 
    db.query(query, (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

// API to get amendments (Joining with the contracts table)
app.get('/api/amendments', (req, res) => {
    const sql = `
        SELECT a.*, c.contract_name 
        FROM amendments a 
        JOIN contracts c ON a.contract_id = c.id
        ORDER BY a.created_at DESC`;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

//Create new amendment
app.post('/api/amendments', (req, res) => {
    const { contract_id, description, impact_cost, impact_days } = req.body;
    const sql = 'INSERT INTO amendments (contract_id, description, impact_cost, impact_days) VALUES (?, ?, ?, ?)';
    db.query(sql, [contract_id, description, impact_cost, impact_days], (err, result) => {
        if (err) return res.status(500).send(err);
        res.json({ success: true, id: result.insertId });
    });
});

//Update amendment status
app.patch('/api/amendments/:id', (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    
    const sql = 'UPDATE amendments SET status = ? WHERE id = ?';
    db.query(sql, [status, id], (err, result) => {
        if (err) {
            console.error("Update Error:", err);
            return res.status(500).send(err);
        }
        res.json({ success: true });
    });
});
// End of Amendament

// Beginning of Archive Section
app.post('/api/contracts/archive', (req, res) => {
    const { id, reason } = req.body;
    const sql = `UPDATE contracts SET is_archived = 1, archive_date = NOW(), 
                 termination_reason = ? WHERE id = ?`;
    db.query(sql, [reason, id], (err) => {
        if (err) return res.status(500).send(err);
        res.sendStatus(200);
    });
});

// Restore
app.post('/api/contracts/restore', (req, res) => {
    const { id } = req.body;
    const sql = "UPDATE contracts SET is_archived = 0, archive_date = NULL, termination_reason = NULL WHERE id = ?";
    db.query(sql, [id], (err) => {
        if (err) return res.status(500).send(err);
        res.sendStatus(200);
    });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
// End of Archive Section

// Click on contract on Dashboard to view details
app.get('/api/full-contract-details/:id', (req, res) => {
    const contractId = req.params.id;

    //Get the main contract data
    const sqlContract = "SELECT * FROM contracts WHERE id = ?";
    db.query(sqlContract, [contractId], (err, contractResult) => {
        if (err) return res.status(500).json({ error: "Database error" });
        if (contractResult.length === 0) return res.status(404).json({ error: "Contract not found" });

        const mainContract = contractResult[0];

        //Get the related rows from the separate 'activities' table
        const sqlActivities = "SELECT * FROM activities WHERE contract_id = ?";
        db.query(sqlActivities, [contractId], (err, activityResults) => {
            if (err) return res.status(500).json({ error: "Database error on activities" });

            //Send back a combined object
            res.json({
                contractInfo: mainContract,
                activitiesList: activityResults
            });
        });
    });
});



// Beginning of Reporting Section
// app.post('/api/reports/export', async (req, res) => {
//     const { startDate, endDate, status, budget, incActivities } = req.body;

//     // Build the SQL Query based on filters
//     let sql = "SELECT * FROM contracts WHERE 1=1";
//     let params = [];

//     if (status !== 'all') { sql += " AND status = ?"; params.push(status); }
//     if (budget !== 'all') { sql += " AND source_of_budget = ?"; params.push(budget); }
//     if (startDate) { sql += " AND start_date >= ?"; params.push(startDate); }
//     if (endDate) { sql += " AND end_date <= ?"; params.push(endDate); }

//     db.query(sql, params, async (err, results) => {
//         if (err) return res.status(500).send(err);

//         const workbook = new ExcelJS.Workbook();
//         const worksheet = workbook.addWorksheet('Contracts Report');

//         // Define Professional Columns
//         worksheet.columns = [
//             { header: 'Contract Name', key: 'contract_name', width: 35 },
//             { header: 'Contract Number', key: 'contract_number', width: 20 },
//             { header: 'Service Provider', key: 'service_provider', width: 25 },
//             { header: 'Value (RWF)', key: 'contract_value', width: 15 },
//             { header: 'Budget Source', key: 'source_of_budget', width: 20 },
//             { header: 'Status', key: 'status', width: 15 },
//             { header: 'Start Date', key: 'start_date', width: 15 },
//             { header: 'End Date', key: 'end_date', width: 15 }
//         ];

//         // Style the Header (RICA Green)
//         worksheet.getRow(1).eachCell((cell) => {
//             cell.font = { bold: true, color: { argb: 'FFFFFF' } };
//             cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '4CAF50' } };
//             cell.alignment = { vertical: 'middle', horizontal: 'center' };
//         });

//         // Add Data Rows
//         results.forEach(contract => {
//             worksheet.addRow(contract);
//         });

//         // Set response headers
//         res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
//         res.setHeader('Content-Disposition', 'attachment; filename=RICA_Report.xlsx');

//         await workbook.xlsx.write(res);
//         res.end();
//     });
// });









// ROUTE 1: Search for contracts by name or number
app.get('/api/reports/search', (req, res) => {
    const searchTerm = `%${req.query.q}%`;
    const sql = "SELECT id, contract_name, contract_number FROM contracts WHERE contract_name LIKE ? OR contract_number LIKE ? LIMIT 1";
    db.query(sql, [searchTerm, searchTerm], (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

// ROUTE 2: Get all activities for a specific ID
app.get('/api/contract-activities/:id', (req, res) => {
    const sql = "SELECT * FROM activities WHERE contract_id = ?";
    db.query(sql, [req.params.id], (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

// Get Payments for Report Preview
app.get('/api/contract-payments/:id', (req, res) => {
    db.query("SELECT * FROM payments WHERE contract_id = ?", [req.params.id], (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

// Get Issues for Report Preview
app.get('/api/contract-issues/:id', (req, res) => {
    db.query("SELECT * FROM issues WHERE contract_id = ?", [req.params.id], (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

// Get Amendments for Report Preview
app.get('/api/contract-amendments/:id', (req, res) => {
    db.query("SELECT * FROM amendments WHERE contract_id = ?", [req.params.id], (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});
// app.post('/api/reports/detailed-export', (req, res) => {
//     const { contractId, activityIds } = req.body;

//     // 1. Validate Input
//     if (!contractId || !activityIds || activityIds.length === 0) {
//         return res.status(400).send("Missing contract ID or selected activities.");
//     }

//     const sqlContract = "SELECT * FROM contracts WHERE id = ?";
//     const sqlActivities = "SELECT * FROM activities WHERE id IN (?)";

//     db.query(sqlContract, [contractId], (err, contractResults) => {
//         if (err || contractResults.length === 0) return res.status(500).send("Database error or contract not found.");
        
//         const contract = contractResults[0];

//         db.query(sqlActivities, [activityIds], async (err, activityResults) => {
//             if (err) return res.status(500).send("Error fetching activities.");

//             try {
//                 const workbook = new ExcelJS.Workbook();
//                 const sheet = workbook.addWorksheet('Contract Report');

//                 // STYLE: Professional Header
//                 sheet.mergeCells('A1:E1');
//                 sheet.getCell('A1').value = 'RICA CONTRACT EXPENDITURE & ACTIVITY REPORT';
//                 sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFF' } };
//                 sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '4CAF50' } };
//                 sheet.getCell('A1').alignment = { horizontal: 'center' };

//                 // SECTION: Contract Details
//                 sheet.addRow([]); // Spacer
//                 sheet.addRow(['CONTRACT INFORMATION']).font = { bold: true };
//                 sheet.addRow(['Contract Name', contract.contract_name]);
//                 sheet.addRow(['Reference No', contract.contract_number]);
//                 sheet.addRow(['Service Provider', contract.service_provider]);
//                 sheet.addRow(['Total Contract Value', `${contract.contract_value} RWF`]);
//                 sheet.addRow(['Budget Source', contract.source_of_budget]);
//                 sheet.addRow(['Status', contract.status]);
//                 sheet.addRow([]); // Spacer

//                 // SECTION: Activity Details Table
//                 sheet.addRow(['DETAILED ACTIVITIES']).font = { bold: true };
//                 const headerRow = sheet.addRow(['Activity Name', 'Timeline', 'Cost (RWF)', 'Deliverable', 'Status']);
                
//                 headerRow.eachCell((cell) => {
//                     cell.font = { bold: true, color: { argb: 'FFFFFF' } };
//                     cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '388E3C' } };
//                 });

//                 activityResults.forEach(act => {
//                     sheet.addRow([
//                         act.activity_name,
//                         act.timeline,
//                         act.cost,
//                         act.deliverable,
//                         act.status
//                     ]);
//                 });

//                 // Auto-adjust column widths
//                 sheet.getColumn(1).width = 40;
//                 sheet.getColumn(2).width = 20;
//                 sheet.getColumn(3).width = 15;
//                 sheet.getColumn(4).width = 30;
//                 sheet.getColumn(5).width = 15;

//                 // Send to browser
//                 res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
//                 res.setHeader('Content-Disposition', `attachment; filename=Report.xlsx`);

//                 await workbook.xlsx.write(res);
//                 res.end();

//             } catch (excelErr) {
//                 console.error(excelErr);
//                 res.status(500).send("Excel Generation Error");
//             }
//         });
//     });
// });










// --- REPORTING ROUTES ---

// Helper function to safely fetch data or return empty array
const fetchTableData = async (query, params) => {
    try {
        const [rows] = await db.promise().query(query, params);
        return rows;
    } catch (e) {
        console.error(e);
        return [];
    }
};

// 1. Fetch data for the Preview Area
app.post('/api/reports/preview-data', async (req, res) => {
    const { contractId, activityIds, incPayments, incIssues, incAmendments } = req.body;

    try {
        const [contracts] = await db.promise().query("SELECT * FROM contracts WHERE id = ?", [contractId]);
        if (contracts.length === 0) return res.status(404).send("Contract not found");

        const activities = activityIds.length > 0 
            ? await fetchTableData("SELECT * FROM activities WHERE id IN (?)", [activityIds]) 
            : [];
            
        const payments = incPayments ? await fetchTableData("SELECT * FROM payments WHERE contract_id = ?", [contractId]) : [];
        const issues = incIssues ? await fetchTableData("SELECT * FROM issues WHERE contract_id = ?", [contractId]) : [];
        const amendments = incAmendments ? await fetchTableData("SELECT * FROM amendments WHERE contract_id = ?", [contractId]) : [];

        res.json({
            contract: contracts[0],
            activities,
            payments,
            issues,
            amendments
        });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// 2. Generate the Expanded Excel File
app.post('/api/reports/detailed-export', async (req, res) => {
    const { contractId, activityIds, incPayments, incIssues, incAmendments } = req.body;

    try {
        // Fetch all required data using Promises
        const [contracts] = await db.promise().query("SELECT * FROM contracts WHERE id = ?", [contractId]);
        if (contracts.length === 0) return res.status(404).send("Contract not found");
        const c = contracts[0];

        const activities = activityIds.length > 0 ? await fetchTableData("SELECT * FROM activities WHERE id IN (?)", [activityIds]) : [];
        const payments = incPayments ? await fetchTableData("SELECT * FROM payments WHERE contract_id = ?", [contractId]) : [];
        const issues = incIssues ? await fetchTableData("SELECT * FROM issues WHERE contract_id = ?", [contractId]) : [];
        const amendments = incAmendments ? await fetchTableData("SELECT * FROM amendments WHERE contract_id = ?", [contractId]) : [];

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Comprehensive Report');

        // --- STYLING HELPERS ---
        const addSectionHeader = (title) => {
            sheet.addRow([]);
            const row = sheet.addRow([title]);
            row.font = { bold: true, size: 12, color: { argb: 'FFFFFF' } };
            row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '4CAF50' } };
            sheet.mergeCells(`A${row.number}:E${row.number}`);
        };

        const addTableHeader = (headers) => {
            const row = sheet.addRow(headers);
            row.eachCell(cell => {
                cell.font = { bold: true };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E8F5E9' } };
            });
        };

        const formatDate = (dateString) => dateString ? new Date(dateString).toISOString().split('T')[0] : 'N/A';

        // --- 1. MAIN TITLE ---
        sheet.mergeCells('A1:E1');
        sheet.getCell('A1').value = 'RICA COMPREHENSIVE CONTRACT REPORT';
        sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFF' } };
        sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '2E7D32' } };
        sheet.getCell('A1').alignment = { horizontal: 'center' };

        // --- 2. EXTENDED CONTRACT INFO ---
        addSectionHeader('CONTRACT DETAILS');
        sheet.addRow(['Contract Name:', c.contract_name, '', 'Contract Manager:', c.contract_manager]);
        sheet.addRow(['Reference No:', c.contract_number, '', 'Manager Phone:', c.manager_phone || 'N/A']);
        sheet.addRow(['Service Provider:', c.service_provider, '', 'Manager Email:', c.manager_email || 'N/A']);
        sheet.addRow(['Tender Type:', c.tender_type || 'N/A', '', 'Contract Type:', c.contract_type || 'N/A']);
        sheet.addRow(['Budget Source:', c.budget_source || 'N/A', '', 'Allocated Budget:', `${c.budget_allocated || 0} RWF`]);
        sheet.addRow(['Start Date:', formatDate(c.start_date), '', 'End Date:', formatDate(c.end_date)]);
        sheet.addRow(['Current Status:', c.status]);

        // --- 3. ACTIVITIES ---
        if (activities.length > 0) {
            addSectionHeader('INCLUDED ACTIVITIES');
            addTableHeader(['Activity Name', 'Timeline', 'Cost (RWF)', 'Deliverable', 'Status']);
            activities.forEach(a => sheet.addRow([a.activity_name, a.timeline, a.cost, a.deliverable, a.status]));
        }

        // --- 4. PAYMENTS ---
        if (incPayments && payments.length > 0) {
            addSectionHeader('PAYMENT HISTORY');
            addTableHeader(['Payment Method', 'Amount (RWF)', 'Due Date', 'Status', 'Attachment Ref']);
            payments.forEach(p => sheet.addRow([p.payment_method, p.amount, formatDate(p.due_date), p.status, p.attachment_path || 'None']));
        }

        // --- 5. ISSUES ---
        if (incIssues && issues.length > 0) {
            addSectionHeader('REPORTED ISSUES');
            addTableHeader(['Title', 'Description', 'Priority', 'Reported Date', '']);
            issues.forEach(i => sheet.addRow([i.title, i.description, i.priority, formatDate(i.reported_date)]));
        }

        // --- 6. AMENDMENTS ---
        if (incAmendments && amendments.length > 0) {
            addSectionHeader('CONTRACT AMENDMENTS');
            addTableHeader(['Description', 'Impact Cost (RWF)', 'Impact Days', 'Status', 'Created At']);
            amendments.forEach(am => sheet.addRow([am.description, am.impact_cost, am.impact_days, am.status, formatDate(am.created_at)]));
        }

        // --- COLUMN WIDTHS ---
        sheet.getColumn(1).width = 25;
        sheet.getColumn(2).width = 30;
        sheet.getColumn(3).width = 15;
        sheet.getColumn(4).width = 25;
        sheet.getColumn(5).width = 25;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Report_${c.contract_number}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error(err);
        res.status(500).send("Excel Generation Error");
    }
});
// End of the Reporting section







// Beginning of changing contract status
// Check activities and complete contract
app.put('/api/contracts/:id/complete', (req, res) => {
    const contractId = req.params.id;

    // 1. Fetch all activities for this contract
    db.query("SELECT status FROM activities WHERE contract_id = ?", [contractId], (err, activities) => {
        if (err) return res.status(500).send(err);
        
        if (activities.length === 0) {
            return res.status(400).json({ error: "No activities found for this contract." });
        }

        // 2. Check if every single activity is 'Completed'
        const allCompleted = activities.every(a => a.status === 'Completed');

        if (!allCompleted) {
            return res.status(400).json({ error: "Cannot complete: Some activities are still Pending or Failed." });
        }

        // 3. Update contract status to 'Completed'
        db.query("UPDATE contracts SET status = 'Completed' WHERE id = ?", [contractId], (err) => {
            if (err) return res.status(500).send(err);
            res.json({ message: "Contract status updated to Completed!" });
        });
    });
});
// The End of Changing contract Status


// START SERVER
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
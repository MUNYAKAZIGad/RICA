const express = require('express');
const mysql = require('mysql2');
const multer = require('multer');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');

// const bcrypt = require('bcryptjs'); // REMOVED: No longer using bcrypt

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.json());
app.use('/uploads', express.static('uploads')); // Serve uploaded files

// 1. DATABASE CONNECTION
// Update these with your MySQL credentials
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '', // <--- CHANGE THIS to your actual MySQL password
    database: 'rica_cms'
});

// Setup File Upload Storage
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// 1. Search Contract
app.get('/api/search/:number', (req, res) => {
    const sql = "SELECT * FROM contracts WHERE contract_name = ?";
    db.query(sql, [req.params.number], (err, result) => {
        if (err) return res.status(500).send(err);
        res.json(result);
    });
});

// 2. Add Payment
app.post('/api/payments', upload.single('attachment'), (req, res) => {
    const { contract_id, payment_method, amount, due_date } = req.body;
    const attachment_path = req.file ? req.file.filename : null;

    const sql = "INSERT INTO payments (contract_id, payment_method, amount, due_date, attachment_path) VALUES (?, ?, ?, ?, ?)";
    db.query(sql, [contract_id, payment_method, amount, due_date, attachment_path], (err, result) => {
        if (err) return res.status(500).send(err);
        res.send({ message: "Payment added successfully!" });
    });
});

// 3. Get All Payments for a Contract
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

// 2. AUTHENTICATION ROUTES

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

/**
 * Endpoint to create a new contract and its associated activities.
 * * It performs a two-step insertion:
 * 1. Inserts the main contract into the 'contracts' table.
 * 2. Uses the auto-generated contract ID (insertId) to link and insert
 * all activities into the 'activities' table.
 */
app.post('/api/contracts', (req, res) => {
    const data = req.body;
    
    // 1. Prepare Contract Data (Step 1 Fields)
    const contractData = {
        contract_name: data.contract_name,
        contract_number: data.contract_nber, // <-- The field in question
        contract_type: data.contract_type,
        service_provider: data.service_provider,
        service_provider_phone: data.service_provider_phone, // New field
        service_provider_email: data.service_provider_email, // New field
        public_institution: data.public_institution, // Default value
        institution_tin: data.tin_number,
        contract_manager: data.manager_name,
        manager_phone: data.manager_phone,
        manager_email: data.manager_email,
        start_date: data.start_date,
        end_date: data.end_date,
        budget_source: data.budget_source,
        partner_name: data.partner_name,
        project_name: data.project_name,
        budget_allocated: data.budget_allocated,
        contract_value: data.contract_value,
        status: 'Pending'
    };

    const sqlContract = 'INSERT INTO contracts SET ?';
    
    // 2. Insert the Contract first
    db.query(sqlContract, contractData, (err, result) => {
        if (err) {
            //CRITICAL DEBUGGING LOGS
            console.error("--- SQL CONTRACT INSERTION FAILED ---");
            console.error("SQL Error Code:", err.code); // e.g., 'ER_DUP_ENTRY'
            console.error("SQL Error Message:", err.message); // The full DB error text
            console.log("Data Payload Sent to DB:", contractData); // What Express tried to insert
            console.error("--------------------------------------");
            
            return res.status(500).json({ 
                error: "Failed to insert contract data", 
                details: err.message 
            });
        }

        // 3. Capture the new Contract ID
        const newContractId = result.insertId;
        
        // ... (Activities parsing and insertion code remains the same)
        
        // 4. Parse Activities Data (Sent as a JSON string from the frontend)
        let activities = [];
        try {
            if (data.activities) {
                activities = JSON.parse(data.activities);
            }
        } catch (e) {
            console.error("Error parsing activities JSON", e);
        }

        if (activities.length > 0) {
            // 5. Prepare Activities for Bulk Insert
            const activityValues = activities.map(act => [
                newContractId, // Link: FOREIGN KEY to the contracts table
                act.name,
                act.timeline,
                act.cost,
                act.deliverable
            ]);

            const sqlActivities = 'INSERT INTO activities (contract_id, activity_name, timeline, cost, deliverable) VALUES ?';
            
            // 6. Insert Activities
            db.query(sqlActivities, [activityValues], (err, result) => {
                if (err) {
                    console.error("Error inserting activities:", err);
                    return res.status(500).json({ error: "Contract saved but activities insertion failed.", contractId: newContractId });
                }
                res.json({ message: 'Contract and Activities Saved Successfully', contractId: newContractId });
            });
        } else {
            // Contract was saved, but no activities were provided
            res.json({ message: 'Contract Saved Successfully (No activities)', contractId: newContractId });
        }
    });
});

// Get Contracts (for Dashboard view)
app.get('/api/contracts', (req, res) => {
    db.query('SELECT * FROM contracts ORDER BY id DESC', (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

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

// 3. CONTRACT ROUTES
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

// --- NEW ROUTES FOR ACTIVITY TRACKING Deliverable ---

// 1. Search Contract by Name
// Handles GET /api/contracts/search?name=ContractName
app.get('/api/contracts/search', (req, res) => {
    const name = req.query.name;
    // Use LIKE for partial matches (searches for any contract name containing the query string)
    const sql = "SELECT * FROM contracts WHERE contract_name LIKE ? LIMIT 1";
    db.query(sql, [`%${name}%`], (err, results) => {
        if (err) return res.status(500).send({ error: 'Search failed' });
        res.json(results);
    });
});

// 2. Get Activities for a specific Contract ID
// Handles GET /api/activities/:contractId
app.get('/api/activities/:contractId', (req, res) => {
    const contractId = req.params.contractId;
    // Retrieves all associated activities for the given contract ID
    const sql = "SELECT * FROM activities WHERE contract_id = ?";
    db.query(sql, [contractId], (err, results) => {
        if (err) return res.status(500).send({ error: 'Failed to retrieve activities' });
        res.json(results);
    });
});

// 3. Update Activity Status
// Handles PUT /api/activities/:id/status
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

// 1. Search Contract
app.get('/api/contracts/:num', (req, res) => {
    const sql = "SELECT * FROM contracts WHERE contract_name = ?";
    db.query(sql, [req.params.num], (err, results) => {
        if (results.length > 0) {
            res.json({ success: true, contract: results[0] });
        } else {
            res.json({ success: false });
        }
    });
});

// 2. Post New Issue
app.post('/api/issues', (req, res) => {
    const { contract_id, title, description, priority, reported_date } = req.body;
    const sql = "INSERT INTO issues (contract_id, title, description, priority, reported_date) VALUES (?, ?, ?, ?, ?)";
    db.query(sql, [contract_id, title, description, priority, reported_date], (err) => {
        if (err) return res.status(500).send(err);
        res.sendStatus(200);
    });
});

// 3. Get Issues for a Contract
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
// --- API Endpoints ---

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
// --- 2. SELF-SERVICE SETTINGS ENDPOINT (Settings Page) ---

// Change password for logged-in user
app.put('/api/users/change-password/:id', (req, res) => {
    const userId = req.params.id;
    const { currentPassword, newPassword } = req.body;

    // Step 1: Verify current password
    const checkQuery = 'SELECT password FROM users WHERE id = ?';
    db.query(checkQuery, [userId], (err, results) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (results.length === 0) return res.status(404).json({ error: 'User not found' });

        if (results[0].password !== currentPassword) {
            return res.status(401).json({ error: 'The current password you entered is incorrect.' });
        }

        // Step 2: Update to new password
        const updateQuery = 'UPDATE users SET password = ? WHERE id = ?';
        db.query(updateQuery, [newPassword, userId], (err, result) => {
            if (err) return res.status(500).json({ error: 'Update failed' });
            res.json({ message: 'Success! Your password has been changed.' });
        });
    });
});

// START SERVER
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
// Duplicate DB initialization and plain-text password update removed.
// If you need to run a one-time update or seed, run a separate script (e.g. scripts/reset-password.js)
// using the existing top-level 'db' connection instead of redeclaring it.
-- 1. Use the correct database
USE rica_cms;
-- ALTER TABLE table_name AUTO_INCREMENT = 1; //This SQL command Reset IDs to Start Counting from One
-- 2. Update 'contracts' table with new fields from the Wizard
-- We use ALTER TABLE to add columns if they are missing.
-- If you are starting fresh, you can just add these to the CREATE TABLE statement.

ALTER TABLE contracts
ADD COLUMN institution_tin VARCHAR(50),
ADD COLUMN contract_type VARCHAR(100), -- 'Fixed-price', 'Time and materials', etc.
ADD COLUMN budget_source VARCHAR(100), -- 'Institutional Funds', 'Partner's Funds'
ADD COLUMN manager_email VARCHAR(100),
ADD COLUMN manager_phone VARCHAR(50);

-- 3. Create a new table for Activities (One-to-Many relationship)
-- Since a contract can have multiple activities, we store them here.
CREATE TABLE IF NOT EXISTS activities (
    id INT AUTO_INCREMENT PRIMARY KEY,
    contract_id INT NOT NULL,
    activity_name VARCHAR(255) NOT NULL,
    timeline VARCHAR(100),
    cost DECIMAL(15, 2) DEFAULT 0,
    deliverable VARCHAR(255),
    FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
);

-- 4. EXAMPLE INSERT: How to insert data from the Wizard into the database

-- Step A: Insert the Contract (Step 1 Data)
INSERT INTO contracts (
    contract_name, 
    service_provider, 
    public_institution, 
    institution_tin, 
    contract_type, 
    budget_source, 
    contract_manager, 
    manager_email, 
    manager_phone, 
    start_date, 
    end_date, 
    budget_allocated, 
    status
) VALUES (
    'Supply of IT Equipment', 
    'TechWorld Ltd', 
    'RICA', 
    '123456789', 
    'Fixed-price', 
    'Institutional Funds', 
    'John Doe', 
    'john@rica.rw', 
    '0780000000', 
    '2025-01-01', 
    '2025-12-31', 
    5000000, 
    'Active'
);

-- Step B: Get the ID of the contract we just created
-- In Node.js, this is returned as `result.insertId`
SET @new_contract_id = LAST_INSERT_ID();

-- Step C: Insert the Activities (Step 2 Data)
INSERT INTO activities (contract_id, activity_name, timeline, cost, deliverable)
VALUES 
(@new_contract_id, 'Initial Delivery', 'Week 1', 1000000, 'Hardware delivered'),
(@new_contract_id, 'Installation', 'Week 2', 500000, 'System setup complete');
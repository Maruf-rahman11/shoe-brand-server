const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");


dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;


// Middleware
app.use(cors());
app.use(express.json());



const serviceAccount = require("./kickbox-admin-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.gdfsllv.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});


const emailTransporter = nodemailer.createTransport(
    {
        service: 'gmail',
        auth: {
            user: process.env.KICK_EMAIL,
            pass: process.env.KICK_EMAIL_PASS
        }
    }
);

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();
        const db = client.db("kickboxbd");
        
        const shoesCollection = db.collection("shoes");
        const ordersCollection = db.collection("orders");


        const verifyFBToken = async (req, res, next) => {
            const authHeader = req.headers.authorization;
            console.log(authHeader)
            if (!authHeader) {
                return res.status(401).send({ message: 'unauthorized access' })
            }
            const token = authHeader.split(' ')[1];
            if (!token) {
                return res.status(401).send({ message: 'unauthorized access' })
            }

            // verify the token
            try {
                const decoded = await admin.auth().verifyIdToken(token);
                req.decoded = decoded;
                next();
            }
            catch (error) {
                return res.status(403).send({ message: 'forbidden access' })
            }
        }

        // EMAIL ROUTE
        app.post('/send-confirmation-email', async (req, res) => {
            const { email, order } = req.body; // receive customer email & order details
            console.log(email, order)

            if (!email || !order) {
                return res.status(400).send({ result: 'Missing email or order data' });
            }

            const emailObj = {
                from: `"KickBox BD" <${process.env.KICK_EMAIL}>`,
                to: email,
                subject: "KickBox Order Received",
                html: `
                <h2>Thank you for your order!</h2>
                <p>We'll call you soon for confirmation.</p>
                <p><strong>Customer Name:</strong> ${order.customer.customerName}</p>
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Contact:</strong> ${order.customer.customerNumber}</p>
                <p><strong>Delivery Zone:</strong> ${order.customer.address}</p>
                <p><strong>District:</strong> ${order.customer.district}</p>
                <p><strong>Total Amount:</strong> ${order.totalAmount}৳</p>
                <h3>Products:</h3>
                <ul>
                  ${order.products.map(p => `<li>${p.name} - Size: ${p.size} - Qty: ${p.quantity} - Price: ${p.price}৳</li>`).join('')}
                </ul>
              `
            };

            try {
                const emailInfo = await emailTransporter.sendMail(emailObj);
                console.log('Email sent:', emailInfo.messageId);
                res.send({ result: 'success' });
            } catch (error) {
                console.log('Email failed:', error);
                res.status(500).send({ result: 'Email Failed' });
            }
        });



        app.get("/orders",verifyFBToken, async (req, res) => {
            const {
                page = 1,
                limit = 8,
                search
            } = req.query;

            const query = {};

            // 🔍 Search by customer number
            if (search) {
                query["customer.customerNumber"] = {
                    $regex: search,
                    $options: "i",
                };
            }

            const skip = (parseInt(page) - 1) * parseInt(limit);

            const orders = await ordersCollection
                .find(query)
                .skip(skip)
                .limit(parseInt(limit))
                .sort({ createdAt: -1 }) // newest first (recommended)
                .toArray();

            const total = await ordersCollection.countDocuments(query);

            res.send({
                orders,
                total,
                page: parseInt(page),
                limit: parseInt(limit),
            });
        });


        app.get("/orders/:id",verifyFBToken, async (req, res) => {
            const { id } = req.params;
            const order = await ordersCollection.findOne({ _id: new ObjectId(id) });

            if (!order) {
                return res.status(404).send({ message: "Order not found" });
            }

            res.send(order);
        });


        app.get("/shoes", async (req, res) => {
            const {
              category,
              popular,
              discount,
              search,
              sort,        // low-high | high-low
              page = 1,
              limit = 8,
            } = req.query;
          
            const query = {};
            let sortQuery = {};
          
            if (category) query.category = category;
            if (popular !== undefined) query.popular = popular === "true";
          
            if (discount === "true") {
              query.discountPrice = { $gt: 0 };
            }
          
            // 🔍 search
            if (search) {
              query.name = { $regex: search, $options: "i" };
            }
          
            // 💰 price sorting
            if (sort === "low-high") {
              sortQuery = discount === "true"
                ? { discountPrice: 1 }
                : { price: 1 };
            }
          
            if (sort === "high-low") {
              sortQuery = discount === "true"
                ? { discountPrice: -1 }
                : { price: -1 };
            }
          
            const skip = (page - 1) * limit;
          
            const shoes = await shoesCollection
              .find(query)
              .sort(sortQuery)
              .skip(skip)
              .limit(parseInt(limit))
              .toArray();
          
            const total = await shoesCollection.countDocuments(query);
          
            res.send({
              shoes,
              total,
              page: parseInt(page),
              limit: parseInt(limit),
            });
          });
          



        app.get("/shoes/:id", async (req, res) => {
            const { id } = req.params;

            const query = { _id: new ObjectId(id) };
            const result = await shoesCollection.findOne(query);
            res.send(result);
        })

        app.post("/shoes",verifyFBToken, async (req, res) => {
            const product = req.body;
            // Insert product into MongoDB
            const result = await shoesCollection.insertOne(product);
            res.send(result);

        });

        app.post("/orders", async (req, res) => {
            try {


                const orderData = req.body;
                
                const { customer, products, totalAmount } = orderData;
                if (
                    !customer ||
                    !customer.customerName ||
                    !customer.email ||
                    !customer.customerNumber ||
                    !customer.district ||
                    !customer.address ||
                    !customer.deliveryZone
                ) {
                    return res.status(400).send({ message: "Customer information is incomplete" });
                }

                // Add metadata
                const newOrder = {
                    ...orderData,
                    status: "pending",        // pending | confirmed | delivered
                    createdAt: new Date(),
                };

                const result = await ordersCollection.insertOne(newOrder);

                res.status(201).send({
                    success: true,
                    insertedId: result.insertedId,
                    message: "Order placed successfully",
                });
            } catch (error) {
                console.error("Error creating order:", error);
                res.status(500).send({ success: false, message: "Failed to place order" });
            }
        });



        app.delete("/shoes/:id",verifyFBToken, async (req, res) => {
            const { id } = req.params;

            try {
                const query = { _id: new ObjectId(id) };
                const result = await shoesCollection.deleteOne(query);

                if (result.deletedCount === 0) {
                    return res.status(404).send({ message: "Shoe not found" });
                }

                res.send({
                    success: true,
                    message: "Shoe deleted successfully",
                    deletedId: id
                });
            } catch (error) {
                res.status(500).send({ message: "Invalid ID or server error" });
            }
        });


        app.delete("/orders/:id",verifyFBToken, async (req, res) => {
            try {
                const { id } = req.params;

                // Validate ObjectId
                if (!ObjectId.isValid(id)) {
                    return res.status(400).send({ message: "Invalid order ID" });
                }

                const result = await ordersCollection.deleteOne({
                    _id: new ObjectId(id),
                });

                if (result.deletedCount === 0) {
                    return res.status(404).send({ message: "Order not found" });
                }

                res.send({
                    success: true,
                    message: "Order deleted successfully",
                });
            } catch (error) {
                console.error("Error deleting order:", error);
                res.status(500).send({
                    success: false,
                    message: "Failed to delete order",
                });
            }
        });

        
          

        app.patch("/shoes/:id", async (req, res) => {
            try {
              const { id } = req.params;
              const updateData = req.body;
          
              const result = await shoesCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                  $set: {
                    ...updateData,
                    updatedAt: new Date(),
                  },
                }
              );
          
              if (result.matchedCount === 0) {
                return res.status(404).send({ message: "Shoe not found" });
              }
          
              res.send({ success: true, message: "Shoe updated successfully" });
            } catch (error) {
              res.status(500).send({ message: "Update failed" });
            }
          });

        app.patch("/items/update/update-stock", async (req, res) => {
            console.log('hello')
            try {
              const { products } = req.body;
              console.log('helop',products)
          
              for (const item of products) {
                const shoe = await shoesCollection.findOne({
                  _id: new ObjectId(item.shoeId),
                });
          
                if (!shoe) {
                  return res.status(404).send({ message: "Product not found" });
                }
          
                // 🟢 Accessories / Shoe care
                if (shoe.stock !== "") {
                  if (shoe.stock < item.quantity) {
                    return res.status(400).send({
                      message: `Out of stock: ${shoe.name}`,
                    });
                  }
          
                  await shoesCollection.updateOne(
                    { _id: shoe._id },
                    {
                      $inc: { stock: -item.quantity },
                      $set: { updatedAt: new Date() },
                    }
                  );
                }
          
                // 🟢 Shoes (size-based)
                else if (shoe.stockBySize && item.size) {
                  const sizeStock = shoe.stockBySize[item.size];
          
                  if (sizeStock < item.quantity) {
                    return res.status(400).send({
                      message: `Size ${item.size} out of stock for ${shoe.name}`,
                    });
                  }
          
                  await shoesCollection.updateOne(
                    { _id: shoe._id },
                    {
                      $inc: {
                        [`stockBySize.${item.size}`]: -item.quantity,
                        totalStock: -item.quantity,
                      },
                      $set: { updatedAt: new Date() },
                    }
                  );
                }
              }
          
              res.send({ success: true });
            } catch (error) {
              console.error("Stock update failed:", error);
              res.status(500).send({ message: "Stock update failed" });
            }
          });

        app.patch("/orders/:id/status", async (req, res) => {
            try {
                const { id } = req.params;
                const { status } = req.body;

                const allowedStatuses = ["pending", "confirmed", "canceled"];

                if (!allowedStatuses.includes(status)) {
                    return res.status(400).send({ message: "Invalid order status" });
                }

                const result = await ordersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            status,
                            updatedAt: new Date(),
                        },
                    }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).send({ message: "Order not found" });
                }

                res.send({ success: true, message: "Order status updated" });
            } catch (error) {
                res.status(500).send({ success: false });
            }
        });

    

        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        //   await client.close();
    }
}
run().catch(console.dir);
app.get("/", (req, res) => {
    res.send("API is running...");
});


// app.get('/', (req, res) => {
//   res.send('Hello World!')
// })

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});


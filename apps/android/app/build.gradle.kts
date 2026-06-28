plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.bestfamilyvault.autofill"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.bestfamilyvault.autofill"
        // Autofill framework requires API 26 (Oreo).
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        viewBinding = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    // Encrypted token storage.
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    // Biometric unlock gate before revealing/filling credentials.
    implementation("androidx.biometric:biometric:1.1.0")
    // Kotlin coroutines for off-main-thread network calls.
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
